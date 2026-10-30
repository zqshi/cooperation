import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import type { Automation, AutomationInput } from "@workagent/contracts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Isolated TEST_DATABASE_URL required");
const schema = "wa_automation_" + randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString: url });
let db: typeof import("@workagent/db");
let core: typeof import("@workagent/core");
let app: FastifyInstance;
const tokens: Record<string, string> = {};
const who = (id = "alice") =>
  ({
    id,
    orgId: id === "foreign" ? "b" : "a",
    role: id === "admin" ? "admin" : "user",
    name: id,
    email: id + "@automation.test",
    orgName: "test",
    avatarUrl: null,
  }) as import("@workagent/core").AuthUser;
const call = (
  id: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: "/v1" + path,
    remoteAddress:
      "127.8.0." + (["alice", "bob", "admin", "foreign"].indexOf(id) + 2),
    headers: id ? { authorization: "Bearer " + tokens[id] } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const input = (extra: Partial<AutomationInput> = {}): AutomationInput => ({
  title: "复盘",
  prompt: "根据给定工作记录整理复盘提纲",
  timezone: "Asia/Shanghai",
  schedule: { kind: "recurring", cron: "0 9 * * *" },
  enabled: true,
  ...extra,
});
const create = async (extra: Partial<AutomationInput> = {}) => {
  const res = await call("alice", "POST", "/automations", input(extra));
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Automation>();
};
const history = async (id: string) =>
  (await call("alice", "GET", `/automations/${id}/history`)).json();
const nowPlus = (ms: number) => new Date(Date.now() + ms).toISOString();
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const testUrl = new URL(url!);
  testUrl.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = testUrl.toString();
  process.env.ENV_FILE = "/tmp/workagent-no-env";
  process.env.USE_MOCK_MODEL = "true";
  db = await import("@workagent/db");
  core = await import("@workagent/core");
  const c = await admin.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(78009412)");
    await c.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    await c.query("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public");
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  for (const file of (
    await fs.readdir(
      new URL("../../../packages/db/migrations/", import.meta.url),
    )
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.query(
      await fs.readFile(
        new URL("../../../packages/db/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "INSERT INTO org(id,name,slug) VALUES('a','Automation A','auto-a'),('b','Automation B','auto-b')",
  );
  for (const id of ["alice", "bob", "admin", "foreign"]) {
    const u = who(id);
    await db.query(
      "INSERT INTO app_user(id,email,name,password_hash) VALUES($1,$2,$1,'unused')",
      [id, u.email],
    );
    await db.query(
      "INSERT INTO membership(org_id,user_id,role,status) VALUES($1,$2,$3,'active')",
      [u.orgId, id, u.role],
    );
    tokens[id] = randomUUID();
    await db.query(
      "INSERT INTO session(org_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [u.orgId, id, core.sha256(tokens[id]!)],
    );
    await core.savePersonalAssistant(
      u,
      { name: id + "搭档", purpose: "文本工作", preferences: "" },
      true,
    );
  }
  await db.query(
    "INSERT INTO quota(org_id,scope,scope_id,monthly_run_limit) VALUES('a','org','a',10000)",
  );
  app = await (await import("../src/server.js")).buildServer();
}, 30000);
afterAll(async () => {
  await app?.close();
  await db?.closePool();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
describe.sequential("owned durable automation", () => {
  it("validates once, cron, IANA timezone, DST, monthly gaps and strict ownership contracts", async () => {
    const n = core.nextAutomationAt;
    expect(n(input(), new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-01-01T01:00:00.000Z",
    );
    expect(
      n(
        input({ timezone: "America/New_York" }),
        new Date("2026-03-08T00:00:00Z"),
      ),
    ).toBe("2026-03-08T13:00:00.000Z");
    expect(
      n(
        input({ schedule: { kind: "recurring", cron: "0 9 31 * *" } }),
        new Date("2026-04-01T00:00:00Z"),
      ),
    ).toBe("2026-05-31T01:00:00.000Z");
    for (const extra of [
      { timezone: "not/a-zone" },
      { schedule: { kind: "recurring", cron: "* * * * *" } },
      { schedule: { kind: "recurring", cron: "0 0 0 * * *" } },
      { schedule: { kind: "recurring", cron: "0,50 * * * *" } },
      { schedule: { kind: "once", at: "2020-01-01T00:00:00Z" } },
    ])
      expect(
        (
          await call(
            "alice",
            "POST",
            "/automations",
            input(extra as Partial<AutomationInput>),
          )
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await call("alice", "POST", "/automations", {
          ...input(),
          agentId: "foreign",
          projectId: "fake",
          ownerId: "bob",
        })
      ).statusCode,
    ).toBe(400);
    expect((await call("", "GET", "/automations")).statusCode).toBe(401);
  });
  it("owner-only CRUD, bounded paging, optimistic edits and no admin/cross-org reads or mutation", async () => {
    const a = await create();
    for (const id of ["bob", "admin", "foreign"]) {
      expect((await call(id, "GET", `/automations/${a.id}`)).statusCode).toBe(
        404,
      );
      expect(
        (await call(id, "GET", `/automations/${a.id}/history`)).statusCode,
      ).toBe(404);
      expect(
        (
          await call(id, "POST", `/automations/${a.id}/trigger`, {
            key: "isolated-key-123",
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await call(id, "PUT", `/automations/${a.id}`, {
            ...input(),
            version: 1,
          })
        ).statusCode,
      ).toBe(404);
      expect((await call(id, "GET", "/automations")).json().items).toEqual([]);
    }
    expect(
      (await call("alice", "GET", "/automations?pageSize=101")).statusCode,
    ).toBe(400);
    expect(
      (await call("alice", "GET", "/automations?page=2&pageSize=1")).json()
        .items,
    ).toEqual([]);
    const edits = await Promise.all([
      call("alice", "PUT", `/automations/${a.id}`, {
        ...input({ title: "edited" }),
        version: 1,
      }),
      call("alice", "PUT", `/automations/${a.id}`, {
        ...input({ title: "race" }),
        version: 1,
      }),
    ]);
    expect(edits.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    await db.query(
      "UPDATE personal_automation SET status='paused' WHERE id=$1",
      [a.id],
    );
  });
  it("once scheduling is atomic and multiple workers dispatch exactly one real run/outbox occurrence", async () => {
    const a = await create({ schedule: { kind: "once", at: nowPlus(30000) } });
    const due = new Date(Date.now() + 60000);
    expect(
      (
        await Promise.all(
          Array.from({ length: 5 }, () => core.dispatchDueAutomations(due)),
        )
      ).reduce((a, b) => a + b, 0),
    ).toBe(1);
    const h = await history(a.id);
    expect(h.total).toBe(1);
    expect(h.items[0]).toMatchObject({
      status: "queued",
      trigger: "scheduled",
      error: null,
    });
    const run = await db.one("SELECT * FROM agent_run WHERE id=$1", [
      h.items[0].runId,
    ]);
    expect(run).toMatchObject({
      user_id: "alice",
      project_id: null,
      agent_id: a.agentId,
      channel: "automation",
    });
    expect(
      await db.one(
        "SELECT count(*)::int n FROM outbox_event WHERE payload->>'runId'=$1",
        [h.items[0].runId],
      ),
    ).toEqual({ n: 1 });
    expect(
      (await call("alice", "GET", `/automations/${a.id}`)).json(),
    ).toMatchObject({ status: "completed", nextAt: null });
    expect(await core.dispatchDueAutomations(due)).toBe(0);
    await core.executeRun(h.items[0].runId, "a");
    expect((await history(a.id)).items[0]).toMatchObject({
      status: "succeeded",
    });
    expect((await history(a.id)).items[0].output).toBeTruthy();
  });
  it("manual trigger is idempotent, overlap is skipped, and history/run detail are real and owner scoped", async () => {
    const a = await create({ enabled: false });
    const calls = await Promise.all(
      Array.from({ length: 4 }, () =>
        call("alice", "POST", `/automations/${a.id}/trigger`, {
          key: "same-request-key",
        }),
      ),
    );
    expect(new Set(calls.map((r) => r.json().id)).size).toBe(1);
    const first = (await history(a.id)).items[0];
    await call("alice", "POST", `/automations/${a.id}/trigger`, {
      key: "second-request-key",
    });
    expect((await history(a.id)).items[0]).toMatchObject({
      status: "skipped",
      runId: null,
    });
    for (const id of ["bob", "admin", "foreign"])
      expect((await call(id, "GET", `/runs/${first.runId}`)).statusCode).toBe(
        404,
      );
    await core.executeRun(first.runId, "a");
    expect(
      (await call("alice", "GET", `/runs/${first.runId}`)).json().run.output,
    ).toBeTruthy();
    const h = await call(
      "alice",
      "GET",
      `/automations/${a.id}/history?page=2&pageSize=1`,
    );
    expect(h.json().items).toHaveLength(1);
    expect(h.json().total).toBe(2);
  });
  it("pause, resume and editing cancel old occurrences; recurring downtime catchup is bounded", async () => {
    let a = await create();
    a = (
      await call("alice", "POST", `/automations/${a.id}/actions`, {
        action: "pause",
        version: a.version,
      })
    ).json();
    await db.query(
      "UPDATE personal_automation SET next_at='2020-01-01' WHERE id=$1",
      [a.id],
    );
    await core.dispatchDueAutomations();
    expect((await history(a.id)).total).toBe(0);
    a = (
      await call("alice", "POST", `/automations/${a.id}/actions`, {
        action: "resume",
        version: a.version,
      })
    ).json();
    expect(new Date(a.nextAt!).getTime()).toBeGreaterThan(Date.now());
    const old = a.nextAt;
    a = (
      await call("alice", "PUT", `/automations/${a.id}`, {
        ...input({ schedule: { kind: "once", at: nowPlus(86400000) } }),
        version: a.version,
      })
    ).json();
    expect(a.nextAt).not.toBe(old);
    await db.query(
      "UPDATE personal_automation SET schedule=$2,next_at='2020-01-01' WHERE id=$1",
      [a.id, JSON.stringify({ kind: "recurring", cron: "0 9 * * *" })],
    );
    const now = new Date();
    await core.dispatchDueAutomations(now);
    expect((await history(a.id)).total).toBe(1);
    expect(
      new Date(
        (await call("alice", "GET", `/automations/${a.id}`)).json().nextAt,
      ).getTime(),
    ).toBeGreaterThan(now.getTime());
    await core.dispatchDueAutomations(now);
    expect((await history(a.id)).total).toBe(1);
    const current = (await call("alice", "GET", `/automations/${a.id}`)).json();
    await call("alice", "POST", `/automations/${a.id}/actions`, {
      action: "pause",
      version: current.version,
    });
  });
  it("terminate/delete cancel queued execution, fence engine resurrection and preserve actual history", async () => {
    const a = await create({ enabled: false });
    await call("alice", "POST", `/automations/${a.id}/trigger`, {
      key: "terminate-request",
    });
    const run = (await history(a.id)).items[0].runId;
    const ended = await call("alice", "POST", `/automations/${a.id}/actions`, {
      action: "terminate",
      version: a.version,
    });
    expect(ended.statusCode).toBe(200);
    await core.executeRun(run, "a");
    expect((await history(a.id)).items[0].status).toBe("canceled");
    expect(
      (
        await call("alice", "POST", `/automations/${a.id}/trigger`, {
          key: "after-terminate",
        })
      ).statusCode,
    ).toBe(409);
    const del = await call("alice", "POST", `/automations/${a.id}/actions`, {
      action: "delete",
      version: ended.json().version,
    });
    expect(del.statusCode).toBe(200);
    expect(
      (await call("alice", "GET", "/automations"))
        .json()
        .items.some((v: Automation) => v.id === a.id),
    ).toBe(false);
    expect((await history(a.id)).total).toBe(1);
  });
  it("dispatch transaction rolls back on audit failure; retry recovers schedule and outbox without duplicates", async () => {
    const a = await create({ schedule: { kind: "once", at: nowPlus(30000) } });
    const now = new Date(Date.now() + 60000);
    const before = await db.one(
      "SELECT current_runs FROM quota WHERE org_id='a'",
    );
    await db.query(
      "CREATE FUNCTION reject_auto_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='automation.dispatch' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_auto_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_auto_audit()",
    );
    try {
      await expect(core.dispatchDueAutomations(now)).rejects.toThrow(
        "audit unavailable",
      );
    } finally {
      await db.query(
        "DROP TRIGGER reject_auto_audit ON audit_log; DROP FUNCTION reject_auto_audit()",
      );
    }
    expect((await history(a.id)).total).toBe(0);
    expect(
      await db.one("SELECT current_runs FROM quota WHERE org_id='a'"),
    ).toEqual(before);
    expect(await core.dispatchDueAutomations(now)).toBe(1);
    expect((await history(a.id)).total).toBe(1);
  });
  it("quota rejection leaves a failed occurrence without partial run/conversation/outbox", async () => {
    const a = await create({ enabled: false });
    const counts = () =>
      db.one(
        "SELECT (SELECT count(*) FROM agent_run)::int runs,(SELECT count(*) FROM conversation)::int conversations,(SELECT count(*) FROM outbox_event)::int jobs",
      );
    const before = await counts();
    await db.query("UPDATE quota SET monthly_run_limit=0 WHERE org_id='a'");
    try {
      await call("alice", "POST", `/automations/${a.id}/trigger`, {
        key: "quota-failure-key",
      });
      expect((await history(a.id)).items[0]).toMatchObject({
        status: "failed",
        runId: null,
        error: "执行额度不足",
      });
      expect(await counts()).toEqual(before);
    } finally {
      await db.query(
        "UPDATE quota SET monthly_run_limit=10000 WHERE org_id='a'",
      );
    }
  });
  it("uses the active compiled revision at dispatch and records real model-unavailable failure, not success", async () => {
    const a = await create({ enabled: false });
    await core.savePersonalAssistant(
      who(),
      { name: "新搭档", purpose: "新的文本指令", preferences: "" },
      false,
    );
    await call("alice", "POST", `/automations/${a.id}/trigger`, {
      key: "no-model-key",
    });
    const run = (await history(a.id)).items[0].runId;
    const revision = await db.one<{ current_revision_id: string }>(
      "SELECT current_revision_id FROM agent WHERE id=$1",
      [a.agentId],
    );
    expect(
      await db.one("SELECT revision_id FROM agent_run WHERE id=$1", [run]),
    ).toEqual({ revision_id: revision!.current_revision_id });
    const cfg = (await import("@workagent/config")).config as unknown as {
      useMockModel: boolean;
      modelApiKey: string;
    };
    const old = {
      useMockModel: cfg.useMockModel,
      modelApiKey: cfg.modelApiKey,
    };
    try {
      cfg.useMockModel = false;
      cfg.modelApiKey = "";
      await core.executeRun(run, "a");
      expect((await history(a.id)).items[0]).toMatchObject({
        status: "failed",
        output: null,
      });
      expect((await history(a.id)).items[0].error).toBeTruthy();
    } finally {
      Object.assign(cfg, old);
    }
  });
  it("rechecks revocation at due claim and worker execution; no personal cross-org attachments", async () => {
    const a = await create({ schedule: { kind: "once", at: nowPlus(30000) } });
    const b = await create({ enabled: false });
    await call("alice", "POST", `/automations/${b.id}/trigger`, {
      key: "revoke-run-key",
    });
    const run = (await history(b.id)).items[0].runId;
    await db.query(
      "UPDATE membership SET status='disabled' WHERE org_id='a' AND user_id='alice'",
    );
    try {
      expect((await call("alice", "GET", "/automations")).statusCode).toBe(401);
      await core.dispatchDueAutomations(new Date(Date.now() + 60000));
      await core.executeRun(run, "a");
      expect(
        await db.one("SELECT status FROM agent_run WHERE id=$1", [run]),
      ).toEqual({ status: "failed" });
      expect(
        await db.one("SELECT status FROM personal_automation WHERE id=$1", [
          a.id,
        ]),
      ).toEqual({ status: "paused" });
      expect(
        await db.one(
          "SELECT status,run_id FROM automation_occurrence WHERE automation_id=$1",
          [a.id],
        ),
      ).toEqual({ status: "failed", run_id: null });
    } finally {
      await db.query(
        "UPDATE membership SET status='active' WHERE org_id='a' AND user_id='alice'",
      );
    }
    await expect(
      db.query("UPDATE personal_automation SET owner_id='bob' WHERE id=$1", [
        a.id,
      ]),
    ).rejects.toThrow("Immutable");
    const foreign = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE personal_owner_id='foreign'",
    ))!.id;
    await expect(
      db.query("UPDATE personal_automation SET agent_id=$2 WHERE id=$1", [
        a.id,
        foreign,
      ]),
    ).rejects.toThrow();
    const bobAgent = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE personal_owner_id='bob'",
    ))!.id;
    const bobRun = await core.createRun({
      orgId: "a",
      userId: "bob",
      agentId: bobAgent,
      message: "private",
    });
    await expect(
      db.query(
        "INSERT INTO automation_occurrence(org_id,automation_id,occurrence_key,scheduled_at,trigger,status,run_id) VALUES('a',$1,'forged',now(),'manual','dispatched',$2)",
        [a.id, bobRun.run.id],
      ),
    ).rejects.toThrow("identity mismatch");
  });
});

it("real worker processes recover an abandoned outbox lease and dedupe due scheduling across workers", async () => {
  const { spawn } = await import("node:child_process");
  const abandoned = await create({ enabled: false });
  await call("alice", "POST", `/automations/${abandoned.id}/trigger`, {
    key: "abandoned-worker-key",
  });
  const abandonedRun = (await history(abandoned.id)).items[0].runId;
  await db.query(
    "UPDATE outbox_event SET status='processing',locked_by='dead-worker',locked_at=now()-interval '10 minutes',attempts=1 WHERE payload->>'runId'=$1",
    [abandonedRun],
  );
  const due = await create({ schedule: { kind: "once", at: nowPlus(30000) } });
  await db.query(
    "UPDATE personal_automation SET next_at=now()-interval '1 second' WHERE id=$1",
    [due.id],
  );
  const children = Array.from({ length: 2 }, () =>
    spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        new URL("../../worker/src/index.ts", import.meta.url).pathname,
      ],
      {
        env: {
          ...process.env,
          ENV_FILE: "/tmp/workagent-no-env",
          NODE_ENV: "test",
          USE_MOCK_MODEL: "true",
        },
        stdio: "ignore",
      },
    ),
  );
  try {
    await expect
      .poll(
        async () => ({
          abandoned: (await history(abandoned.id)).items[0]?.status,
          due: (await history(due.id)).items[0]?.status,
        }),
        { timeout: 15000 },
      )
      .toEqual({ abandoned: "succeeded", due: "succeeded" });
    expect((await history(due.id)).total).toBe(1);
    const dueRun = (await history(due.id)).items[0].runId;
    await expect
      .poll(
        async () =>
          await db.one(
            "SELECT count(*)::int n FROM outbox_event WHERE payload->>'runId'=ANY($1::text[]) AND status='processed'",
            [[dueRun, abandonedRun]],
          ),
        { timeout: 5000 },
      )
      .toEqual({ n: 2 });
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
          }),
      ),
    );
  }
}, 25000);

it("schedule edits and cancellation roll back together when mutation audit fails; concurrent trigger/delete cannot leave live runs", async () => {
  const a = await create({ enabled: false });
  await call("alice", "POST", `/automations/${a.id}/trigger`, {
    key: "rollback-action-key",
  });
  await db.query(
    "CREATE FUNCTION reject_auto_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('automation.edit','automation.terminate') THEN RAISE EXCEPTION 'mutation audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_auto_mutation BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_auto_mutation()",
  );
  try {
    expect(
      (
        await call("alice", "PUT", `/automations/${a.id}`, {
          ...input({ title: "should rollback" }),
          version: a.version,
        })
      ).statusCode,
    ).toBe(500);
    expect(
      (
        await call("alice", "POST", `/automations/${a.id}/actions`, {
          action: "terminate",
          version: a.version,
        })
      ).statusCode,
    ).toBe(500);
    expect(
      (await call("alice", "GET", `/automations/${a.id}`)).json(),
    ).toMatchObject({ title: a.title, status: "paused", version: a.version });
    expect((await history(a.id)).items[0].status).toBe("queued");
  } finally {
    await db.query(
      "DROP TRIGGER reject_auto_mutation ON audit_log; DROP FUNCTION reject_auto_mutation()",
    );
  }
  const results = await Promise.all([
    call("alice", "POST", `/automations/${a.id}/actions`, {
      action: "delete",
      version: a.version,
    }),
    call("alice", "POST", `/automations/${a.id}/trigger`, {
      key: "race-delete-trigger",
    }),
  ]);
  expect(results[0]!.statusCode).toBe(200);
  expect([200, 409]).toContain(results[1]!.statusCode);
  expect(
    (await history(a.id)).items.every(
      (r: { status: string }) =>
        !["queued", "running", "waiting_approval"].includes(r.status),
    ),
  ).toBe(true);
});
