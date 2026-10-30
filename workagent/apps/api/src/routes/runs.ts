import { z } from "zod";
import { tx } from "@workagent/db";
import { forbidden, conflict } from "@workagent/core";
import type { FastifyInstance } from "fastify";
import { createRunSchema } from "@workagent/contracts";
import {
  ensureDefaultProject,
  tooMany,
  requireRunAccess,
  runAccessSql,
  cancelRun,
  canOperate,
  createRun,
  getConversationMessages,
  getRunDetail,
  getRunEvents,
  listConversations,
  listRuns,
  notFound,
  getSessionUser,
  SESSION_COOKIE,
} from "@workagent/core";
import { one } from "@workagent/db";

const streams = new Map<string, number>();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const TERMINAL = new Set(["succeeded", "failed", "canceled", "timeout"]);

export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/runs/:id/acceptance", async (req) => {
    await requireRunAccess(req.user, req.params.id);
    if (!canOperate(req.user)) {
      const pm = await one(
        "SELECT pm.user_id FROM agent_run r JOIN project_member pm ON pm.project_id=r.project_id AND pm.org_id=r.org_id WHERE r.id=$1 AND pm.user_id=$2 AND pm.role='manager'",
        [req.params.id, req.user.id],
      );
      if (!pm) throw forbidden();
    }
    const linked = await one(
      "SELECT 1 FROM agent_run WHERE id=$1 AND project_id IS NOT NULL",
      [req.params.id],
    );
    if (linked) await requireRunAccess(req.user, req.params.id, true);
    const input = z
      .object({
        decision: z.enum(["accepted", "rejected"]),
        note: z.string().max(4000).default(""),
      })
      .strict()
      .parse(req.body);
    return tx(async (c) => {
      await requireRunAccess(req.user, req.params.id, true, c);
      const r = (
        await c.query<{ user_id: string; status: string }>(
          "SELECT user_id,status FROM agent_run WHERE org_id=$1 AND id=$2 FOR UPDATE",
          [req.user.orgId, req.params.id],
        )
      ).rows[0];
      if (!r) throw notFound();
      if (r.user_id === req.user.id) throw forbidden("执行者不能自验收");
      const responsible = await c.query(
        "SELECT 1 FROM project_task_attempt pa JOIN project_task pt ON pt.id=pa.task_id AND pt.org_id=pa.org_id AND pt.project_id=pa.project_id WHERE pa.run_id=$1 AND (pt.assignee_id=$2 OR pt.submitted_by=$2)",
        [req.params.id, req.user.id],
      );
      if (responsible.rowCount) throw forbidden("执行者不能自验收");
      if (r.status !== "succeeded") throw conflict("运行尚未成功");
      const existing = (
        await c.query<{ decision: string; reviewer_id: string }>(
          "SELECT decision,reviewer_id FROM run_acceptance WHERE run_id=$1",
          [req.params.id],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.decision === input.decision &&
          existing.reviewer_id === req.user.id
        )
          return { ok: true };
        throw conflict("已验收");
      }
      await c.query(
        "INSERT INTO run_acceptance(run_id,org_id,reviewer_id,decision,note) VALUES($1,$2,$3,$4,$5)",
        [
          req.params.id,
          req.user.orgId,
          req.user.id,
          input.decision,
          input.note,
        ],
      );
      await c.query(
        "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id) VALUES($1,$2,$3,'run',$4)",
        [req.user.orgId, req.user.id, "run." + input.decision, req.params.id],
      );
      return { ok: true };
    });
  });
  app.post("/runs", async (request) => {
    const input = createRunSchema.parse(request.body);
    const result = await createRun({
      orgId: request.user.orgId,
      userId: request.user.id,
      agentId: input.agentId,
      message: input.message,
      conversationId: input.conversationId,
      channel: input.channel,
      idempotencyKey: input.idempotencyKey,
    });
    return result;
  });

  app.get("/runs", async (request) => {
    const queryParams = request.query as {
      scope?: string;
      personal?: string;
      agentId?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    };
    const { page, pageSize } = pageSchema.parse(queryParams);
    const canSeeAll = canOperate(request.user) && queryParams.scope === "all";
    const result = await listRuns({
      orgId: request.user.orgId,
      userId: request.user.id,
      all: canSeeAll,
      personalOnly: queryParams.personal === "true",
      agentId: queryParams.agentId,
      status: queryParams.status,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { ...result, page, pageSize };
  });

  app.get("/runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    const detail = await getRunDetail(id, request.user.orgId);
    if (!detail) throw notFound("任务不存在");
    await requireRunAccess(request.user, id);
    const capabilities = await one<{ canWrite: boolean; canAccept: boolean }>(
      `SELECT
      ${runAccessSql("$2", "$3", "r", "write")} AS "canWrite",
      (r.status='succeeded' AND r.user_id<>$2 AND ${runAccessSql("$2", "$3", "r", true)}
       AND NOT EXISTS(SELECT 1 FROM project_task_attempt pa JOIN project_task pt ON pt.id=pa.task_id AND pt.org_id=pa.org_id AND pt.project_id=pa.project_id WHERE pa.run_id=r.id AND (pt.assignee_id=$2 OR pt.submitted_by=$2))
       AND NOT EXISTS(SELECT 1 FROM run_acceptance ra WHERE ra.run_id=r.id)) AS "canAccept"
       FROM agent_run r WHERE r.id=$1 AND r.org_id=$4`,
      [id, request.user.id, canOperate(request.user), request.user.orgId],
    );
    const acceptance = await one<{
      decision: "accepted" | "rejected";
      note: string;
      createdAt: string;
    }>(
      `SELECT decision,note,created_at AS "createdAt" FROM run_acceptance WHERE run_id=$1 AND org_id=$2`,
      [id, request.user.orgId],
    );
    const task = detail.run.projectId
      ? await one<{ id: string; title: string }>(
          `SELECT pt.id,pt.title FROM project_task_attempt pa JOIN project_task pt ON pt.id=pa.task_id AND pt.org_id=pa.org_id AND pt.project_id=pa.project_id WHERE pa.org_id=$1 AND pa.run_id=$2 AND pa.project_id=$3`,
          [request.user.orgId, id, detail.run.projectId],
        )
      : null;
    // Never replace immutable provenance with the default read projection.
    const contextProjectId =
      detail.run.projectId ??
      (detail.run.userId === request.user.id
        ? (await ensureDefaultProject(request.user)).id
        : null);
    const occurrence =
      detail.run.userId === request.user.id
        ? await one<{ automationId: string }>(
            'SELECT automation_id AS "automationId" FROM automation_occurrence o JOIN personal_automation a ON a.id=o.automation_id AND a.org_id=o.org_id WHERE o.org_id=$1 AND a.owner_id=$2 AND o.run_id=$3',
            [request.user.orgId, request.user.id, id],
          )
        : null;
    return {
      ...detail,
      contextProjectId,
      automationId: occurrence?.automationId ?? null,
      capabilities,
      acceptance,
      task,
    };
  });

  app.post("/runs/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    const detail = await getRunDetail(id, request.user.orgId);
    if (!detail) throw notFound("任务不存在");
    await requireRunAccess(request.user, id);
    const run = await cancelRun(id, request.user.orgId, request.user.id);
    return { run };
  });

  app.get("/runs/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = await getRunDetail(id, request.user.orgId);
    if (!detail) throw notFound("任务不存在");
    await requireRunAccess(request.user, id);

    const headerLastId = request.headers["last-event-id"];
    const queryLastId = (request.query as { after?: string }).after;
    let lastSeq = Number(headerLastId ?? queryLastId ?? 0);
    if (!Number.isSafeInteger(lastSeq) || lastSeq < 0) lastSeq = 0;

    const streamKey = request.user.orgId + ":" + request.user.id;
    if (
      (streams.get(streamKey) ?? 0) >= 3 ||
      [...streams.values()].reduce((a, b) => a + b, 0) >= 100
    )
      throw tooMany("SSE connection limit reached");
    streams.set(streamKey, (streams.get(streamKey) ?? 0) + 1);
    reply.hijack();
    reply.raw.writeHead(200, {
      ...Object.fromEntries(
        Object.entries(reply.getHeaders())
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");

    let closed = false;
    reply.raw.on("close", () => {
      closed = true;
    });

    let heartbeat = Date.now();
    try {
      for (;;) {
        if (closed) break;
        const token =
          request.cookies[SESSION_COOKIE] ??
          request.headers.authorization?.replace(/^Bearer /, "");
        const liveUser = await getSessionUser(token);
        if (!liveUser) break;
        await requireRunAccess(liveUser, id);
        const events = await getRunEvents(id, lastSeq);
        for (const event of events) {
          lastSeq = event.seq;
          reply.raw.write(`id: ${event.seq}\n`);
          if (!reply.raw.write(`data: ${JSON.stringify(event.payload)}\n\n`)) {
            await new Promise<void>((resolve) => {
              const finish = () => {
                clearTimeout(timer);
                reply.raw.off("drain", finish);
                reply.raw.off("close", finish);
                resolve();
              };
              const timer = setTimeout(() => {
                closed = true;
                finish();
              }, 5000);
              reply.raw.once("drain", finish);
              reply.raw.once("close", finish);
            });
            if (closed) break;
          }
        }

        if (Date.now() - heartbeat > 15_000) {
          reply.raw.write(
            `data: ${JSON.stringify({ type: "heartbeat", at: new Date().toISOString() })}\n\n`,
          );
          heartbeat = Date.now();
        }

        const run = await one<{ status: string }>(
          "SELECT status FROM agent_run WHERE id = $1 AND org_id=$2",
          [id, request.user.orgId],
        );
        if (!run || (TERMINAL.has(run.status) && events.length === 0)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      request.log.warn({ requestId: request.id }, "SSE closed");
    } finally {
      const count = (streams.get(streamKey) ?? 1) - 1;
      if (count) streams.set(streamKey, count);
      else streams.delete(streamKey);
      reply.raw.end();
    }
  });

  app.get("/conversations", async (request) => {
    const queryParams = request.query as { page?: string; pageSize?: string };
    const { page, pageSize } = pageSchema.parse(queryParams);
    const result = await listConversations({
      orgId: request.user.orgId,
      userId: request.user.id,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { ...result, page, pageSize };
  });

  app.get("/conversations/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const messages = await getConversationMessages(
      id,
      request.user.orgId,
      request.user.id,
    );
    if (!messages) throw notFound("会话不存在");
    return { items: messages, total: messages.length };
  });
}
