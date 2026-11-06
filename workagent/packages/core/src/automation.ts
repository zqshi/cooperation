import { CronExpressionParser } from "cron-parser";
import type { PoolClient } from "pg";
import { tx } from "@workagent/db";
import {
  automationInputSchema,
  automationEditSchema,
  automationActionSchema,
  type AutomationInput,
  type Automation,
  type AutomationOccurrence,
} from "@workagent/contracts";
import type { AuthUser } from "./auth.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { audit } from "./audit.js";
import { createRun } from "./runs.js";

type Row = {
  id: string;
  org_id: string;
  owner_id: string;
  agent_id: string;
  title: string;
  prompt: string;
  timezone: string;
  schedule: AutomationInput["schedule"];
  status: Automation["status"];
  version: number;
  next_at: string | null;
  created_at: string;
  updated_at: string;
};
const map = (r: Row): Automation => ({
  id: r.id,
  agentId: r.agent_id,
  title: r.title,
  prompt: r.prompt,
  timezone: r.timezone,
  schedule: r.schedule,
  enabled: r.status === "active",
  status: r.status,
  version: r.version,
  nextAt: r.next_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const activeStates = "('queued','running','waiting_approval')";
/** Five-field cron with IANA timezone semantics, including DST. Never parse cron ourselves. */
export function nextAutomationAt(
  input: Pick<AutomationInput, "timezone" | "schedule">,
  now = new Date(),
  requireFuture = true,
): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(now);
  } catch {
    throw badRequest("无效 IANA 时区");
  }
  if (input.schedule.kind === "once") {
    const at = new Date(input.schedule.at);
    if (
      !Number.isFinite(at.getTime()) ||
      at.getUTCFullYear() > 2099 ||
      (requireFuture && at <= now)
    )
      throw badRequest("单次执行时间须在未来且不晚于 2099 年");
    return at.toISOString();
  }
  try {
    if (input.schedule.cron.split(/\s+/).length !== 5) throw new Error();
    const expression = CronExpressionParser.parse(input.schedule.cron, {
      currentDate: now,
      tz: input.timezone,
    });
    const next = expression.next().toDate();
    // Restrict minute sets to at least 15 minutes on the circular clock. This
    // conservative bound applies to every day, not a finite future sample.
    const minutes = expression.fields.minute.values as number[];
    for (let i = 0; i < minutes.length; i++)
      if (
        ((minutes[(i + 1) % minutes.length]! - minutes[i]! + 60) % 60 || 60) <
        15
      )
        throw new Error();
    if (next.getUTCFullYear() > 2099) throw new Error();
    return next.toISOString();
  } catch {
    throw badRequest("请使用有效的五段 cron；分钟间隔至少 15 分钟");
  }
}
async function lockOrg(c: PoolClient, org: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    org + ":run.create",
  ]);
}
async function live(c: PoolClient, org: string, owner: string, agent?: string) {
  if (
    !(
      await c.query(
        "SELECT id FROM org WHERE id=$1 AND status='active' FOR SHARE",
        [org],
      )
    ).rowCount
  )
    throw notFound("企业已停用");
  if (
    !(
      await c.query(
        "SELECT user_id FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
        [org, owner],
      )
    ).rowCount
  )
    throw notFound("身份已停用");
  const a = (
    await c.query<{ id: string }>(
      `SELECT a.id FROM agent a JOIN agent_revision rev ON rev.id=a.current_revision_id AND rev.agent_id=a.id WHERE a.org_id=$1 AND a.personal_owner_id=$2 AND ($3::text IS NULL OR a.id=$3) AND a.status='published' AND rev.status='published' AND rev.bootstrap IS NOT NULL FOR SHARE OF a,rev`,
      [org, owner, agent ?? null],
    )
  ).rows[0];
  if (!a) throw conflict("个人搭档未就绪");
  return a.id;
}
async function own(c: PoolClient, u: AuthUser, id: string) {
  const r = (
    await c.query<Row>(
      "SELECT * FROM personal_automation WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE",
      [u.orgId, u.id, id],
    )
  ).rows[0];
  if (!r) throw notFound();
  await live(c, u.orgId, u.id, r.agent_id);
  return r;
}
async function log(
  c: PoolClient,
  r: Row,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await audit(
    {
      orgId: r.org_id,
      actorId: r.owner_id,
      action: "automation." + action,
      resourceType: "automation",
      resourceId: r.id,
      metadata,
    },
    c,
  );
}
export async function saveAutomation(u: AuthUser, raw: unknown, id?: string) {
  const data = id
    ? automationEditSchema.parse(raw)
    : automationInputSchema.parse(raw);
  const next = nextAutomationAt(data);
  return tx(async (c) => {
    await lockOrg(c, u.orgId);
    const agent = await live(c, u.orgId, u.id);
    let r: Row;
    if (id) {
      const prev = await own(c, u, id);
      if (prev.version !== ("version" in data ? data.version : 0))
        throw conflict("日程已更新，请重新加载");
      if (["terminated", "deleted"].includes(prev.status))
        throw conflict("此日程已终止");
      r = (
        await c.query<Row>(
          "UPDATE personal_automation SET title=$2,prompt=$3,timezone=$4,schedule=$5,status=$6,next_at=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            id,
            data.title,
            data.prompt,
            data.timezone,
            JSON.stringify(data.schedule),
            data.enabled ? "active" : "paused",
            next,
          ],
        )
      ).rows[0]!;
    } else {
      r = (
        await c.query<Row>(
          "INSERT INTO personal_automation(org_id,owner_id,agent_id,title,prompt,timezone,schedule,status,next_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            u.orgId,
            u.id,
            agent,
            data.title,
            data.prompt,
            data.timezone,
            JSON.stringify(data.schedule),
            data.enabled ? "active" : "paused",
            next,
          ],
        )
      ).rows[0]!;
    }
    await log(c, r, id ? "edit" : "create", { version: r.version });
    return map(r);
  });
}
export async function automationAction(u: AuthUser, id: string, raw: unknown) {
  const data = automationActionSchema.parse(raw);
  return tx(async (c) => {
    await lockOrg(c, u.orgId);
    const r = await own(c, u, id);
    if (r.version !== data.version) throw conflict("日程已更新，请重新加载");
    if (
      r.status === "deleted" ||
      (r.status === "terminated" && data.action !== "delete")
    )
      throw conflict("此日程已终止");
    let next = r.next_at;
    if (data.action === "resume") next = nextAutomationAt(r);
    const status = {
      pause: "paused",
      resume: "active",
      terminate: "terminated",
      delete: "deleted",
    }[data.action];
    if (data.action === "terminate" || data.action === "delete") {
      const canceled = await c.query<{ id: string }>(
        `UPDATE agent_run SET status='canceled',finished_at=now(),error='Automation terminated by owner' WHERE id IN (SELECT run_id FROM automation_occurrence WHERE automation_id=$1 AND org_id=$2) AND status IN ${activeStates} RETURNING id`,
        [r.id, r.org_id],
      );
      for (const run of canceled.rows) {
        await c.query(
          "UPDATE approval SET status='expired',decided_at=now() WHERE run_id=$1 AND status='pending'",
          [run.id],
        );
        await audit(
          {
            orgId: r.org_id,
            actorId: r.owner_id,
            action: "run.cancel",
            resourceType: "run",
            resourceId: run.id,
          },
          c,
        );
      }
      next = null;
    }
    const updated = (
      await c.query<Row>(
        "UPDATE personal_automation SET status=$2,next_at=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [r.id, status, next],
      )
    ).rows[0]!;
    await log(c, updated, data.action);
    return map(updated);
  });
}
// SAVEPOINT permits recording genuine dispatch rejection without leaving a partial
// run, quota increment, conversation or outbox job. Audit failure still rolls back all.
async function dispatch(
  c: PoolClient,
  r: Row,
  key: string,
  at: string,
  trigger: "manual" | "scheduled",
) {
  const existing = (
    await c.query<{ id: string }>(
      "SELECT id FROM automation_occurrence WHERE automation_id=$1 AND occurrence_key=$2",
      [r.id, key],
    )
  ).rows[0];
  if (existing) return existing;
  let status = "dispatched",
    runId: string | null = null,
    error: string | null = null;
  await c.query("SAVEPOINT automation_dispatch");
  try {
    await live(c, r.org_id, r.owner_id, r.agent_id);
    const overlap = await c.query(
      `SELECT 1 FROM automation_occurrence o JOIN agent_run r ON r.id=o.run_id WHERE o.automation_id=$1 AND r.status IN ${activeStates} LIMIT 1`,
      [r.id],
    );
    if (overlap.rowCount) {
      status = "skipped";
      error = "已有执行进行中，本次跳过";
    } else
      runId = (
        await createRun(
          {
            orgId: r.org_id,
            userId: r.owner_id,
            agentId: r.agent_id,
            message: r.prompt,
            channel: "automation",
            idempotencyKey: "automation:" + r.id + ":" + key,
          },
          c,
        )
      ).run.id;
    await c.query("RELEASE SAVEPOINT automation_dispatch");
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT automation_dispatch");
    await c.query("RELEASE SAVEPOINT automation_dispatch");
    // Never store database/provider details, prompts or credentials in scheduler failures.
    status = "failed";
    error =
      e instanceof Error && /quota/i.test(e.message)
        ? "执行额度不足"
        : "身份、个人搭档或执行配置已不可用";
  }
  const result = (
    await c.query<{ id: string }>(
      "INSERT INTO automation_occurrence(org_id,automation_id,occurrence_key,scheduled_at,trigger,status,run_id,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [r.org_id, r.id, key, at, trigger, status, runId, error],
    )
  ).rows[0]!;
  await log(c, r, "dispatch", {
    occurrenceId: result.id,
    runId,
    status,
    trigger,
  });
  return result;
}
export async function triggerAutomation(u: AuthUser, id: string, key: string) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw badRequest("需要有效的幂等请求标识");
  return tx(async (c) => {
    await lockOrg(c, u.orgId);
    const r = await own(c, u, id);
    if (["deleted", "terminated"].includes(r.status))
      throw conflict("此日程已终止");
    return dispatch(c, r, "manual:" + key, new Date().toISOString(), "manual");
  });
}
/** One bounded batch, no timer ownership in core. Transaction rollback is crash
 * recovery; schedule advancement, occurrence, run, quota, outbox and audit commit together.
 * After downtime dispatch at most one due occurrence and advance recurring to > now.
 */
export async function dispatchDueAutomations(now = new Date(), limit = 50) {
  const { query } = await import("@workagent/db");
  const candidates = await query<{ id: string; org_id: string }>(
    "SELECT id,org_id FROM personal_automation WHERE status='active' AND next_at<=$1 ORDER BY next_at,id LIMIT $2",
    [now.toISOString(), Math.max(1, Math.min(limit, 100))],
  );
  let claimed = 0;
  for (const candidate of candidates)
    await tx(async (c) => {
      await lockOrg(c, candidate.org_id);
      const r = (
        await c.query<Row>(
          "SELECT * FROM personal_automation WHERE id=$1 AND status='active' AND next_at<=$2 FOR UPDATE SKIP LOCKED",
          [candidate.id, now.toISOString()],
        )
      ).rows[0];
      if (!r) return;
      const at = r.next_at!;
      await dispatch(c, r, "scheduled:" + at, at, "scheduled");
      let next: string | null = null,
        status = r.schedule.kind === "once" ? "completed" : "active";
      // Revocation disables future scheduling; dispatch already records the failure.
      try {
        await live(c, r.org_id, r.owner_id, r.agent_id);
        if (r.schedule.kind === "recurring") next = nextAutomationAt(r, now);
      } catch {
        status = "paused";
      }
      await c.query(
        "UPDATE personal_automation SET status=$2,next_at=$3,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, status, next],
      );
      claimed++;
    });
  return claimed;
}
export async function readAutomations(
  u: AuthUser,
  id?: string,
  page = 1,
  pageSize = 20,
) {
  return tx(async (c) => {
    await live(c, u.orgId, u.id);
    const scope = [u.orgId, u.id, id ?? null];
    const condition =
      "org_id=$1 AND owner_id=$2 AND ($3::text IS NULL OR id=$3)";
    if (id) {
      const r = (
        await c.query<Row>(
          `SELECT * FROM personal_automation WHERE ${condition}`,
          scope,
        )
      ).rows[0];
      if (!r) throw notFound();
      return map(r);
    }
    const total = Number(
      (
        await c.query(
          `SELECT count(*) FROM personal_automation WHERE ${condition} AND status!='deleted'`,
          scope,
        )
      ).rows[0].count,
    );
    const rows = await c.query<Row>(
      `SELECT * FROM personal_automation WHERE ${condition} AND status!='deleted' ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
      [...scope, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.rows.map(map), total };
  });
}
export async function automationHistory(
  u: AuthUser,
  id: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: AutomationOccurrence[]; total: number }> {
  return tx(async (c) => {
    await own(c, u, id);
    const total = Number(
      (
        await c.query(
          "SELECT count(*) FROM automation_occurrence WHERE org_id=$1 AND automation_id=$2",
          [u.orgId, id],
        )
      ).rows[0].count,
    );
    const rows = await c.query(
      `SELECT o.id,o.automation_id AS "automationId",o.scheduled_at AS "scheduledAt",o.trigger,COALESCE(r.status,o.status) AS status,o.run_id AS "runId",r.output,COALESCE(r.error,o.error) AS error,o.created_at AS "createdAt" FROM automation_occurrence o LEFT JOIN agent_run r ON r.id=o.run_id AND r.org_id=o.org_id AND r.user_id=$3 AND r.project_id IS NULL WHERE o.org_id=$1 AND o.automation_id=$2 ORDER BY o.created_at DESC,o.id DESC LIMIT $4 OFFSET $5`,
      [u.orgId, id, u.id, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.rows, total };
  });
}
