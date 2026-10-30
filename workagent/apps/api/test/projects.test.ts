import { createServer } from "node:http";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";

// Mandatory real PostgreSQL test: refuses to silently skip or use a production DB.
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL must point to an isolated PostgreSQL database (see docs/testing.md)",
  );
const schema = `wa_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
let app: FastifyInstance;
let db: typeof import("@workagent/db");
let p1: string, p2: string;
const tokens: Record<string, string> = {};
let fixtureSubnet = 0;
async function call(
  who: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    remoteAddress: `127.0.${fixtureSubnet}.${["owner", "member", "viewer", "outsider", "foreign", "audit", "builder", "disabled"].indexOf(who) + 2}`,
    url: `/v1${path}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}
beforeAll(async () => {
  const setup = await admin.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("SELECT pg_advisory_xact_lock(78009412)");
    await setup.query(
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public",
    );
    await setup.query(
      "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public",
    );
    await setup.query(`DO $$ BEGIN
 IF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='vector') <> 'public' THEN ALTER EXTENSION vector SET SCHEMA public; END IF;
 IF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='pgcrypto') <> 'public' THEN ALTER EXTENSION pgcrypto SET SCHEMA public; END IF;
END $$`);
    await setup.query("COMMIT");
  } finally {
    setup.release();
  }
  await admin.query(`CREATE SCHEMA ${schema}`);
  const testUrl = new URL(url!);
  testUrl.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.USE_MOCK_MODEL = "true";
  process.env.TEST_TOOL_LOOPBACK = "1";
  process.env.DATABASE_URL = testUrl.toString();
  process.env.ENV_FILE = "/tmp/workagent-no-env";
  db = await import("@workagent/db");
  // Use exact foundational DDL from 001; 002 is tested verbatim on plain PostgreSQL.
  const initial = await fs.readFile(
    new URL("../../../packages/db/migrations/001_init.sql", import.meta.url),
    "utf8",
  );
  await db.query(initial);
  await db.query(
    `INSERT INTO org(id,name,slug) VALUES ('a','A','a'),('b','B','b')`,
  );
  const { sha256 } = await import("@workagent/core");
  for (const [id, org, role] of [
    ["owner", "a", "owner"],
    ["member", "a", "user"],
    ["viewer", "a", "user"],
    ["outsider", "a", "admin"],
    ["foreign", "b", "owner"],
    ["audit", "a", "auditor"],
    ["builder", "a", "builder"],
    ["disabled", "a", "user"],
  ]) {
    await db.query(
      `INSERT INTO app_user(id,email,name,password_hash) VALUES($1,$2,$1,'unused')`,
      [id, `${id}@test.local`],
    );
    await db.query(
      `INSERT INTO membership(org_id,user_id,role,status) VALUES($1,$2,$3,'active')`,
      [org, id, role],
    );
    tokens[id!] = randomUUID();
    await db.query(
      `INSERT INTO session(org_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`,
      [org, id, sha256(tokens[id!]!)],
    );
  }
  await db.query(
    await fs.readFile(
      new URL(
        "../../../packages/db/migrations/002_projects.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    await fs.readFile(
      new URL(
        "../../../packages/db/migrations/003_platform_admin.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const file of [
    "004_project_tasks.sql",
    "005_security.sql",
    "006_run_completion.sql",
    "007_tool_invocations.sql",
    "008_reference_integrity.sql",
    "009_review_boundaries.sql",
    "010_run_project_provenance.sql",
    "011_platform_lifecycle.sql",
    "012_personal_assistant.sql",
    "013_personal_automation.sql",
    "014_default_projects.sql",
  ])
    await db.query(
      await fs.readFile(
        new URL(`../../../packages/db/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  const { buildServer } = await import("../src/server.js");
  app = await buildServer();
}, 30000);
afterAll(async () => {
  await app?.close();
  await db?.closePool();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
describe.sequential("real project authorization and isolation", () => {
  it("rejects unauthenticated requests and auditor creation", async () => {
    expect((await call("", "GET", "/projects")).statusCode).toBe(401);
    expect(
      (await call("audit", "POST", "/projects", { name: "forbidden" }))
        .statusCode,
    ).toBe(403);
  });
  it("creates project and creator membership atomically; validates contracts", async () => {
    expect(
      (await call("owner", "POST", "/projects", { name: " " })).statusCode,
    ).toBe(400);
    const response = await call("owner", "POST", "/projects", {
      name: "Alpha",
    });
    expect(response.statusCode).toBe(201);
    p1 = response.json().project.id;
    expect(response.json().project.role).toBe("manager");
    p2 = (await call("member", "POST", "/projects", { name: "Beta" })).json()
      .project.id;
  });
  it("does not allow org administrators or another project owner implicit access", async () => {
    for (const who of ["member", "outsider", "foreign"]) {
      expect((await call(who, "GET", `/projects/${p1}`)).statusCode).toBe(404);
      expect(
        (await call(who, "GET", `/projects/${p1}/members`)).statusCode,
      ).toBe(404);
      expect(
        (
          await call(who, "PUT", `/projects/${p1}/members`, {
            userId: "viewer",
            role: "viewer",
          })
        ).statusCode,
      ).toBe(404);
    }
    expect((await call("owner", "GET", `/projects/${p2}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call("foreign", "GET", "/projects"))
        .json()
        .items.filter((p: { is_default: boolean }) => !p.is_default),
    ).toEqual([]);
  });
  it("manager adds active same-org members only", async () => {
    expect(
      (
        await call("owner", "PUT", `/projects/${p1}/members`, {
          userId: "foreign",
          role: "viewer",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call("owner", "PUT", `/projects/${p1}/members`, {
          userId: "viewer",
          role: "owner",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("owner", "PUT", `/projects/${p1}/members`, {
          userId: "viewer",
          role: "viewer",
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("viewer", "GET", `/projects/${p1}`)).statusCode).toBe(
      200,
    );
    expect(
      (await call("viewer", "GET", "/projects"))
        .json()
        .items.filter((p: { is_default: boolean }) => !p.is_default)
        .map((p: { id: string }) => p.id),
    ).toEqual([p1]);
  });
  it("viewer and contributor cannot manage members; manager can update", async () => {
    for (const role of ["viewer", "contributor"]) {
      await call("owner", "PUT", `/projects/${p1}/members`, {
        userId: "viewer",
        role,
      });
      expect(
        (
          await call("viewer", "PUT", `/projects/${p1}/members`, {
            userId: "member",
            role: "manager",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await call("viewer", "GET", `/projects/${p1}/candidates`)).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await call("owner", "PUT", `/projects/${p1}/members`, {
          userId: "owner",
          role: "viewer",
        })
      ).statusCode,
    ).toBe(403);
  });
  it("project role promotion grants management and demotion revokes it", async () => {
    await call("owner", "PUT", `/projects/${p1}/members`, {
      userId: "viewer",
      role: "manager",
    });
    expect(
      (
        await call("viewer", "PUT", `/projects/${p1}/members`, {
          userId: "member",
          role: "contributor",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("viewer", "GET", `/projects/${p1}/candidates`)).statusCode,
    ).toBe(200);
    await call("owner", "PUT", `/projects/${p1}/members`, {
      userId: "viewer",
      role: "viewer",
    });
    expect(
      (
        await call("viewer", "PUT", `/projects/${p1}/members`, {
          userId: "member",
          role: "manager",
        })
      ).statusCode,
    ).toBe(403);
  });
  it("disabling org membership revokes existing sessions immediately", async () => {
    expect(
      (
        await call("owner", "PUT", `/projects/${p1}/members`, {
          userId: "disabled",
          role: "viewer",
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("disabled", "GET", `/projects/${p1}`)).statusCode).toBe(
      200,
    );
    await db.query(
      `UPDATE membership SET status='disabled' WHERE user_id='disabled'`,
    );
    expect((await call("disabled", "GET", "/projects")).statusCode).toBe(401);
    expect(
      (
        await call("owner", "PUT", `/projects/${p1}/members`, {
          userId: "disabled",
          role: "viewer",
        })
      ).statusCode,
    ).toBe(404);
  });
  it("database rejects cross-org project member references", async () => {
    await expect(
      db.query(
        `INSERT INTO project_member(org_id,project_id,user_id,role) VALUES('b',$1,'foreign','viewer')`,
        [p1],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.query(
        `INSERT INTO project_member(org_id,project_id,user_id,role) VALUES('a',$1,'foreign','viewer')`,
        [p1],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("governance reads reject business users on server", async () => {
    for (const path of [
      "/members",
      "/channels",
      "/usage",
      "/dashboard",
      "/audit",
    ]) {
      expect((await call("member", "GET", path)).statusCode).toBe(403);
    }
  });
  it("builder resource endpoints reject users before exposing definitions", async () => {
    for (const path of [
      "/skills",
      "/connectors",
      "/knowledge-spaces",
      "/eval-datasets",
      "/eval-runs",
      "/agents/hidden-definition",
    ]) {
      expect((await call("member", "GET", path)).statusCode).toBe(403);
    }
  });
  it("platform API rejects anonymous and every ungranted enterprise role", async () => {
    for (const path of [
      "/platform/me",
      "/platform/overview",
      "/platform/tenants",
    ]) {
      expect((await call("", "GET", path)).statusCode).toBe(401);
      for (const who of [
        "owner",
        "outsider",
        "foreign",
        "audit",
        "member",
        "builder",
      ]) {
        expect((await call(who, "GET", path)).statusCode).toBe(401);
      }
    }
  });
  it("explicit platform grant permits bounded global metadata but never tenant or project bypass", async () => {
    await db.query("INSERT INTO platform_admin(user_id) VALUES('member')");
    const { sha256 } = await import("@workagent/core");
    await db.query(
      "INSERT INTO platform_session(token_hash,user_id,expires_at) VALUES($1,'member',now()+interval '1 hour')",
      [sha256(tokens.member!)],
    );
    expect((await call("member", "GET", "/platform/me")).json()).toEqual({
      userId: "member",
      platformAdmin: true,
    });
    expect(
      (await call("member", "GET", "/platform/overview")).json().tenantCount,
    ).toBe(2);
    const tenants = (await call("member", "GET", "/platform/tenants")).json()
      .items;
    expect(tenants.map((t: { id: string }) => t.id).sort()).toEqual(["a", "b"]);
    expect(Object.keys(tenants[0]).sort()).toEqual([
      "activeMemberCount",
      "createdAt",
      "id",
      "name",
      "plan",
      "slug",
    ]);
    expect((await call("member", "GET", "/members")).statusCode).toBe(403);
    expect((await call("member", "GET", "/skills")).statusCode).toBe(403);
    expect((await call("member", "GET", `/projects/${p1}`)).statusCode).toBe(
      200,
    ); // explicitly assigned earlier
    expect((await call("member", "GET", "/org")).json().org.id).toBe("a");
    expect(
      (await call("member", "POST", "/platform/tenants", { name: "Forbidden" }))
        .statusCode,
    ).toBe(400);
    await db.query("DELETE FROM platform_admin WHERE user_id='member'");
    expect((await call("member", "GET", "/platform/tenants")).statusCode).toBe(
      401,
    );
  });
  it("platform grant does not confer membership to any project or restore disabled sessions", async () => {
    await db.query(
      "INSERT INTO platform_admin(user_id) VALUES('outsider'),('disabled')",
    );
    expect((await call("outsider", "GET", `/projects/${p1}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call("outsider", "GET", "/projects"))
        .json()
        .items.filter((p: { is_default: boolean }) => !p.is_default),
    ).toEqual([]);
    expect(
      (await call("disabled", "GET", "/platform/tenants")).statusCode,
    ).toBe(401);
    await db.query("DELETE FROM platform_admin");
  });
  it("builder cannot manage enterprise members and auditor cannot build", async () => {
    expect((await call("builder", "GET", "/members")).statusCode).toBe(403);
    for (const path of [
      "/skills",
      "/connectors",
      "/knowledge-spaces",
      "/eval-datasets",
    ]) {
      expect((await call("audit", "GET", path)).statusCode).toBe(403);
    }
  });
  it("obsolete and arbitrary origins receive no CORS authorization", async () => {
    for (const origin of [
      "http://localhost:5175",
      "http://localhost:5176",
      "https://untrusted.invalid",
    ]) {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/v1/projects",
        headers: { origin, "access-control-request-method": "GET" },
      });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });
  it("CORS supports only the two current products", async () => {
    for (const port of [5173, 5174]) {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/v1/projects",
        headers: {
          origin: `http://localhost:${port}`,
          "access-control-request-method": "GET",
        },
      });
      expect(res.headers["access-control-allow-origin"]).toBe(
        `http://localhost:${port}`,
      );
    }
  });
  it("task board enforces membership, active assignments, versions and independent acceptance", async () => {
    const base = `/projects/${p1}/tasks`;
    expect((await call("outsider", "GET", base)).statusCode).toBe(404);
    expect(
      (
        await call("owner", "POST", base, {
          title: "Task",
          assigneeId: "foreign",
        })
      ).statusCode,
    ).toBe(404);
    let r = await call("owner", "POST", base, {
      title: "Task",
      description: "Acceptance context",
      assigneeId: "member",
    });
    expect(r.statusCode).toBe(201);
    let t = r.json().task;
    expect(
      (
        await call("member", "PATCH", `${base}/${t.id}`, {
          version: t.version,
          status: "review",
        })
      ).statusCode,
    ).toBe(200);
    t = (await call("owner", "GET", base))
      .json()
      .items.find((x: { id: string }) => x.id === t.id);
    expect(
      (
        await call("member", "PATCH", `${base}/${t.id}`, {
          version: t.version,
          status: "done",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("owner", "PATCH", `${base}/${t.id}`, {
          version: 1,
          status: "done",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call("owner", "PATCH", `${base}/${t.id}`, {
          version: t.version,
          status: "done",
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("owner", "DELETE", `${base}/${t.id}`)).statusCode).toBe(
      409,
    );
    expect((await call("foreign", "GET", base)).statusCode).toBe(404);
  });
  it("real login, assembly, publish, queued execution, approval resume, artifact and task attempt loop", async () => {
    const core = await import("@workagent/core");
    await db.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
      "owner",
      await core.hashPassword("Test-password-2026!"),
    ]);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@test.local", password: "Test-password-2026!" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeTruthy();
    const fixture = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ orderId: "A20260101", status: "shipped" }));
    });
    await new Promise<void>((resolve) =>
      fixture.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (fixture.address() as { port: number }).port;
      const connector = (
        await call("owner", "POST", "/connectors", {
          name: "Test orders",
          type: "http",
          baseUrl: `http://127.0.0.1:${port}`,
          authType: "none",
          tools: [
            {
              name: "lookup_order",
              description: "Lookup order",
              method: "POST",
              path: "/orders",
              inputSchema: {
                type: "object",
                properties: { orderId: { type: "string" } },
                required: ["orderId"],
              },
              risk: "high",
              approvalRequired: true,
            },
          ],
        })
      ).json().connector;
      expect(connector?.id).toBeTruthy();
      await db.query("UPDATE connector SET status='active' WHERE id=$1", [
        connector.id,
      ]);
      const created = await call("owner", "POST", "/agents", {
        definition: {
          name: "Test assistant",
          instructions: "Find orders",
          tools: { connectorIds: [connector.id], skillIds: [] },
          approval: { mode: "always" },
        },
      });
      expect(created.statusCode).toBe(200);
      const agentId = created.json().agent.id;
      expect(
        (await call("owner", "POST", `/agents/${agentId}/publish`, {}))
          .statusCode,
      ).toBe(200);
      const base = `/projects/${p1}/tasks`;
      const task = (
        await call("owner", "POST", base, {
          title: "查询订单 A20260101",
          assigneeId: "member",
          agentId,
        })
      ).json().task;
      const attempt = await call(
        "member",
        "POST",
        `${base}/${task.id}/attempts`,
        { key: "one" },
      );
      expect(attempt.statusCode).toBe(200);
      const runId = attempt.json().run.id;
      expect(
        (
          await call("member", "POST", `${base}/${task.id}/attempts`, {
            key: "one",
          })
        ).json().run.id,
      ).toBe(runId);
      await core.executeRun(runId, "a");
      const waiting = await core.getRunDetail(runId, "a");
      expect(waiting?.run.status).toBe("waiting_approval");
      const approvalId = waiting!.approval!.id;
      const decisions = await Promise.all([
        call("owner", "POST", `/approvals/${approvalId}/decide`, {
          decision: "approve",
          note: "",
        }),
        call("owner", "POST", `/approvals/${approvalId}/decide`, {
          decision: "approve",
          note: "",
        }),
      ]);
      expect(decisions.map((d) => d.statusCode)).toEqual([200, 200]);
      await core.executeRun(runId, "a");
      const complete = await core.getRunDetail(runId, "a");
      expect(complete?.run.status).toBe("succeeded");
      expect(complete?.artifacts).toHaveLength(1);
      const artifactId = complete!.artifacts[0]!.id;
      expect(
        (await call("member", "GET", `/artifacts/${artifactId}/download`))
          .statusCode,
      ).toBe(200);
      expect(
        (await call("foreign", "GET", `/artifacts/${artifactId}/download`))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await call("member", "POST", `${base}/${task.id}/references`, {
            artifactId,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call("owner", "POST", `/runs/${runId}/acceptance`, {
            decision: "accepted",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call("owner", "POST", `/runs/${runId}/acceptance`, {
            decision: "accepted",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call("member", "POST", `/runs/${runId}/acceptance`, {
            decision: "accepted",
          })
        ).statusCode,
      ).toBe(403);
      let t = (await call("member", "GET", base))
        .json()
        .items.find((t: { id: string }) => t.id === task.id);
      expect(
        (
          await call("member", "PATCH", `${base}/${task.id}`, {
            version: t.version,
            status: "review",
          })
        ).statusCode,
      ).toBe(200);
      t = (await call("owner", "GET", base))
        .json()
        .items.find((t: { id: string }) => t.id === task.id);
      expect(
        (
          await call("owner", "PATCH", `${base}/${task.id}`, {
            version: t.version,
            status: "done",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await db.query(
            "SELECT * FROM project_task_attempt WHERE task_id=$1",
            [task.id],
          )
        ).length,
      ).toBe(1);
    } finally {
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
    }
  });
  it("cookie CSRF and security headers reject untrusted mutations", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: {
        cookie: `wa_session=${tokens.owner}`,
        origin: "https://evil.invalid",
      },
      payload: { name: "CSRF" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/projects",
          headers: { cookie: `wa_session=${tokens.owner}` },
          payload: { name: "CSRF" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("queue claims concurrently, retries to DLQ, and recovers stale leases", async () => {
    const core = await import("@workagent/core");
    await db.query("DELETE FROM outbox_event");
    let count = 0;
    const id = await core.enqueue({
      orgId: "a",
      type: "test.fail",
      payload: {},
    });
    const worker = core.createWorker({
      name: "test",
      concurrency: 4,
      pollMs: 20,
      maxAttempts: 2,
      handlers: {
        "test.fail": async () => {
          count++;
          throw new Error("secret-do-not-store");
        },
      },
    });
    try {
      for (let i = 0; i < 150; i++) {
        const r = await db.one<{ status: string }>(
          "SELECT status FROM outbox_event WHERE id=$1",
          [id],
        );
        if (r?.status === "failed") break;
        await new Promise((r) => setTimeout(r, 30));
      }
      const r = await db.one<{
        status: string;
        last_error: string;
        attempts: number;
      }>("SELECT * FROM outbox_event WHERE id=$1", [id]);
      expect(r?.status).toBe("failed");
      expect(r?.attempts).toBe(2);
      expect(count).toBe(2);
      expect(r?.last_error).not.toContain("secret");
    } finally {
      await worker.stop();
    }
    await db.query(
      "UPDATE outbox_event SET status='processing',attempts=1,locked_at=now()-interval '5 minutes',locked_by='dead' WHERE id=$1",
      [id],
    );
    await core.recoverStaleJobs();
    expect(
      (
        await db.one<{ status: string }>(
          "SELECT status FROM outbox_event WHERE id=$1",
          [id],
        )
      )?.status,
    ).toBe("pending");
  }, 10000);
  it("cancellation is idempotent, terminal updates cannot resurrect, and expired approval terminates", async () => {
    const core = await import("@workagent/core");
    const agent = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
    ))!;
    const create = () =>
      core.createRun({
        orgId: "a",
        userId: "member",
        agentId: agent.id,
        message: "查询订单 A20260101",
      });
    const first = await create();
    await core.executeRun(first.run.id, "a");
    expect((await core.getRunDetail(first.run.id, "a"))?.run.status).toBe(
      "waiting_approval",
    );
    await Promise.all([
      core.cancelRun(first.run.id, "a"),
      core.cancelRun(first.run.id, "a"),
    ]);
    await core.updateRun({ runId: first.run.id, status: "succeeded" });
    await core.executeRun(first.run.id, "a");
    expect((await core.getRunDetail(first.run.id, "a"))?.run.status).toBe(
      "canceled",
    );
    expect(
      (
        await db.query(
          "SELECT id FROM audit_log WHERE resource_id=$1 AND action='run.cancel'",
          [first.run.id],
        )
      ).length,
    ).toBe(1);
    const second = await create();
    await core.executeRun(second.run.id, "a");
    await db.query(
      "UPDATE approval SET created_at=now()-interval '25 hours' WHERE run_id=$1",
      [second.run.id],
    );
    expect(await core.expirePendingApprovals()).toBe(1);
    expect((await core.getRunDetail(second.run.id, "a"))?.run.status).toBe(
      "timeout",
    );
    const third = await create();
    await core.executeRun(third.run.id, "a");
    const waiting = await core.getRunDetail(third.run.id, "a");
    await core.decideApproval({
      approvalId: waiting!.approval!.id,
      orgId: "a",
      userId: "owner",
      decision: "reject",
      note: "Denied",
    });
    await core.executeRun(third.run.id, "a");
    const done = await core.getRunDetail(third.run.id, "a");
    expect(done?.run.status).toBe("succeeded");
    expect(done?.run.toolCalls).toBe(0);
  });
  it("real pgvector ingestion and retrieval are isolated by enterprise", async () => {
    const core = await import("@workagent/core");
    const space = (
      await call("owner", "POST", "/knowledge-spaces", { name: "Test policy" })
    ).json().space;
    expect(space?.id).toBeTruthy();
    const boundary = "workagent-test-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="policy.txt"\r\nContent-Type: text/plain\r\n\r\nRefund policy requires independent human approval.\r\n--${boundary}--\r\n`,
    );
    const upload = await app.inject({
      method: "POST",
      url: `/v1/knowledge-spaces/${space.id}/documents`,
      headers: {
        authorization: `Bearer ${tokens.owner}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const doc = upload.json().document;
    await core.ingestDocument(doc.id);
    expect(
      (await core.retrieve([space.id], "Refund policy", 5, 0, "a")).length,
    ).toBeGreaterThan(0);
    expect(await core.retrieve([space.id], "Refund policy", 5, 0, "b")).toEqual(
      [],
    );
    await expect(
      db.query(
        "INSERT INTO document(org_id,space_id,name,mime_type,storage_key) VALUES('b',$1,'bad','text/plain','bad')",
        [space.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("platform principal uses independent sessions without enterprise membership and revokes immediately", async () => {
    const core = await import("@workagent/core");
    const password = "Platform-test-2026!";
    await db.query(
      "INSERT INTO app_user(id,email,name,password_hash) VALUES('platform-only','platform@test.local','Platform',$1)",
      [await core.hashPassword(password)],
    );
    await db.query(
      "INSERT INTO platform_admin(user_id) VALUES('platform-only')",
    );
    const login = await app.inject({
      method: "POST",
      url: "/v1/platform-auth/login",
      payload: { email: "platform@test.local", password },
    });
    expect(login.statusCode).toBe(200);
    const token = await core.platformLogin("platform@test.local", password);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/platform/tenants",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/projects",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
    await db.query("DELETE FROM platform_admin WHERE user_id='platform-only'");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/platform/tenants",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("project removal revokes access and ownership transfers preserve a manager", async () => {
    const p = (
      await call("owner", "POST", "/projects", { name: "Transfer test" })
    ).json().project;
    await call("owner", "PUT", `/projects/${p.id}/members`, {
      userId: "member",
      role: "contributor",
    });
    expect(
      (
        await call("owner", "POST", `/projects/${p.id}/transfer`, {
          userId: "member",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("owner", "DELETE", `/projects/${p.id}/members/member`))
        .statusCode,
    ).toBe(403);
    expect(
      (await call("member", "DELETE", `/projects/${p.id}/members/owner`))
        .statusCode,
    ).toBe(200);
    expect((await call("owner", "GET", `/projects/${p.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call("member", "GET", `/projects/${p.id}`)).json().project.role,
    ).toBe("manager");
  });
  it("login throttling returns 429 and ignores forged proxy headers", async () => {
    let res;
    for (let i = 0; i < 11; i++)
      res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: "127.0.0.77",
        headers: { "x-forwarded-for": `8.8.8.${i}` },
        payload: { email: "missing@test.local", password: "Invalid-password" },
      });
    expect(res!.statusCode).toBe(429);
  });

  it("MCP HTTP and JSON-RPC failures are propagated without leaking provider body", async () => {
    const core = await import("@workagent/core");
    let mode = "http";
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw);
      res.setHeader("content-type", "application/json");
      if (mode === "http") {
        res.writeHead(503);
        res.end("private-secret");
        return;
      }
      res.end(
        JSON.stringify(
          rpc.method === "initialize"
            ? { jsonrpc: "2.0", id: 1, result: { capabilities: {} } }
            : {
                jsonrpc: "2.0",
                id: 2,
                error: { code: -1, message: "private-secret" },
              },
        ),
      );
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    try {
      const port = (fixture.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}`;
      const c = await db.one<{ id: string }>(
        "INSERT INTO connector(org_id,name,type,mcp_url,auth_type,status) VALUES('a','MCP test','mcp',$1,'none','active') RETURNING id",
        [url],
      );
      const tool = {
        name: "test_tool",
        description: "Test",
        source: "mcp" as const,
        inputSchema: { type: "object" },
        config: { connectorId: c!.id, mcpUrl: url },
        risk: "low" as const,
        approvalRequired: false,
        timeoutMs: 1000,
        maxRetries: 0,
      };
      await expect(
        core.executeTool(
          tool,
          {},
          { orgId: "a", agentId: "x", runId: "x", userId: "owner" },
        ),
      ).rejects.toMatchObject({ code: "mcp_error" });
      mode = "rpc";
      await expect(
        core.executeTool(
          tool,
          {},
          { orgId: "a", agentId: "x", runId: "x", userId: "owner" },
        ),
      ).rejects.not.toHaveProperty(
        "message",
        expect.stringContaining("private-secret"),
      );
      await expect(
        core.executeTool(
          tool,
          {},
          { orgId: "b", agentId: "x", runId: "x", userId: "foreign" },
        ),
      ).rejects.toMatchObject({ code: "bad_request" });
    } finally {
      await new Promise<void>((r) => fixture.close(() => r()));
    }
  });

  it("durable tool results replay from the ledger and uncertain side effects never execute twice", async () => {
    const core = await import("@workagent/core");
    const row = await db.one<{
      run_id: string;
      call_id: string;
      result: unknown;
    }>(
      "SELECT run_id,call_id,result FROM tool_invocation WHERE status='succeeded' LIMIT 1",
    );
    expect(row).toBeTruthy();
    const run = await core.getRunRecord(row!.run_id, "a");
    const tool = run!.revision_bootstrap.toolPlan.tools[0]!;
    const result = await core.executeTool(
      tool,
      { orderId: "A20260101" },
      {
        orgId: "a",
        agentId: run!.agent_id,
        runId: row!.run_id,
        userId: run!.user_id,
        invocationId: row!.call_id,
      },
    );
    expect(result).toEqual(row!.result);
    await db.query(
      "INSERT INTO tool_invocation(org_id,run_id,call_id,request_hash) VALUES('a',$1,'uncertain','unknown')",
      [row!.run_id],
    );
    await expect(
      core.executeTool(
        tool,
        { orderId: "A20260101" },
        {
          orgId: "a",
          agentId: run!.agent_id,
          runId: row!.run_id,
          userId: run!.user_id,
          invocationId: "uncertain",
        },
      ),
    ).rejects.toMatchObject({ code: "tool_outcome_unknown" });
  });
  it("signed channel ingress requires binding, encrypts keys and transactionally deduplicates replays", async () => {
    const core = await import("@workagent/core");
    const agent = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
    ))!;
    const key = "Test-channel-encryption-key";
    const account = await core.createChannelAccount({
      orgId: "a",
      type: "feishu",
      name: "Signed test",
      appId: "fixture",
      appSecret: "test-secret",
      verificationToken: "test-token",
      encryptKey: key,
      defaultAgentId: agent.id,
    });
    const stored = await db.one<{
      encrypt_key: string;
      verification_token: string;
    }>(
      "SELECT encrypt_key,verification_token FROM channel_account WHERE id=$1",
      [account.id],
    );
    expect(stored?.encrypt_key).not.toBe(key);
    expect(stored?.verification_token).not.toBe("test-token");
    const body = {
      header: { event_id: "signed-event", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "external-user" } },
        message: {
          message_id: "signed-message",
          chat_id: "signed-chat",
          message_type: "text",
          content: JSON.stringify({ text: "hello" }),
        },
      },
    };
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "test-nonce";
    const signature = createHash("sha256")
      .update(timestamp + nonce + key + raw)
      .digest("hex");
    const webhook = () =>
      app.inject({
        method: "POST",
        url: `/v1/channels/feishu/${account.id}/webhook`,
        headers: {
          "content-type": "application/json",
          "x-lark-request-timestamp": timestamp,
          "x-lark-request-nonce": nonce,
          "x-lark-signature": signature,
        },
        payload: raw,
      });
    expect((await webhook()).statusCode).toBe(403);
    expect(
      (
        await db.query("SELECT * FROM channel_replay WHERE account_id=$1", [
          account.id,
        ])
      ).length,
    ).toBe(0);
    expect(
      (
        await call("owner", "PUT", `/channels/${account.id}/bindings`, {
          userId: "member",
          externalUserId: "external-user",
        })
      ).statusCode,
    ).toBe(200);
    const mine = await call("member", "GET", "/channels/mine");
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items).toContainEqual({
      id: account.id,
      name: "Signed test",
      type: "feishu",
      status: "active",
      configured: true,
      hasAgent: true,
    });
    expect(JSON.stringify(mine.json())).not.toContain("external-user");
    expect(JSON.stringify(mine.json())).not.toContain("test-secret");
    expect(
      (await call("owner", "GET", "/channels/mine")).json().items,
    ).not.toContainEqual(expect.objectContaining({ id: account.id }));
    expect(
      (await call("foreign", "GET", "/channels/mine")).json().items,
    ).toEqual([]);
    expect((await call("", "GET", "/channels/mine")).statusCode).toBe(401);
    const first = await webhook();
    expect(first.statusCode).toBe(200);
    expect(first.json().runId).toBeTruthy();
    const repeat = await webhook();
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().duplicate).toBe(true);
    expect(
      (
        await db.query("SELECT * FROM channel_message WHERE account_id=$1", [
          account.id,
        ])
      ).length,
    ).toBe(1);
  });
  it("DLQ inspection and retry are scoped, authorized and audited", async () => {
    const job = await db.one<{ id: string }>(
      "INSERT INTO outbox_event(org_id,type,payload,status) VALUES('a','test.retry','{}','failed') RETURNING id",
    );
    expect((await call("member", "GET", "/queue")).statusCode).toBe(403);
    expect(
      (await call("foreign", "POST", `/queue/${job!.id}/retry`, {})).statusCode,
    ).toBe(404);
    expect(
      (await call("audit", "POST", `/queue/${job!.id}/retry`, {})).statusCode,
    ).toBe(403);
    expect(
      (await call("owner", "POST", `/queue/${job!.id}/retry`, {})).statusCode,
    ).toBe(200);
    expect(
      (
        await db.query(
          "SELECT id FROM audit_log WHERE action='queue.retry' AND resource_id=$1",
          [job!.id],
        )
      ).length,
    ).toBe(1);
  });
  it("live queue heartbeat prevents stale recovery during a long handler", async () => {
    const core = await import("@workagent/core");
    await db.query("DELETE FROM outbox_event");
    const id = await core.enqueue({
      orgId: "a",
      type: "test.heartbeat",
      payload: {},
    });
    let started = false;
    const worker = core.createWorker({
      name: "heartbeat",
      pollMs: 10,
      heartbeatMs: 30,
      concurrency: 1,
      handlers: {
        "test.heartbeat": async () => {
          started = true;
          await new Promise((r) => setTimeout(r, 400));
        },
      },
    });
    try {
      for (let i = 0; i < 50 && !started; i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(started).toBe(true);
      await db.query(
        "UPDATE outbox_event SET locked_at=now()-interval '5 minutes' WHERE id=$1",
        [id],
      );
      await new Promise((r) => setTimeout(r, 90));
      await core.recoverStaleJobs();
      expect(
        (
          await db.one<{ status: string }>(
            "SELECT status FROM outbox_event WHERE id=$1",
            [id],
          )
        )?.status,
      ).toBe("processing");
    } finally {
      await worker.stop();
    }
    expect(
      (
        await db.one<{ status: string }>(
          "SELECT status FROM outbox_event WHERE id=$1",
          [id],
        )
      )?.status,
    ).toBe("processed");
  });
  it("SSE replays persisted sequence and closes when its real session is revoked", async () => {
    const core = await import("@workagent/core");
    const canceled = (await db.one<{ id: string }>(
      "SELECT id FROM agent_run WHERE org_id='a' AND user_id='member' AND status='canceled' LIMIT 1",
    ))!;
    const replay = await call("member", "GET", `/runs/${canceled.id}/events`);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["content-type"]).toContain("text/event-stream");
    expect(replay.body).toContain("id:");
    expect(replay.body).toContain("canceled");
    const agent = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
    ))!;
    const run = await core.createRun({
      orgId: "a",
      userId: "member",
      agentId: agent.id,
      message: "SSE revocation",
    });
    const token = randomUUID();
    await db.query(
      "INSERT INTO session(org_id,user_id,token_hash,expires_at) VALUES('a','member',$1,now()+interval '1 hour')",
      [core.sha256(token)],
    );
    const stream = app.inject({
      method: "GET",
      url: `/v1/runs/${run.run.id}/events`,
      headers: { authorization: `Bearer ${token}` },
    });
    const result = Promise.resolve(stream);
    await new Promise((r) => setTimeout(r, 60));
    await db.query("DELETE FROM session WHERE token_hash=$1", [
      core.sha256(token),
    ]);
    expect((await result).body).toContain("retry: 3000");
  }, 5000);
});

describe.sequential("independent review regressions", () => {
  it("project runs deny nonmember admin and removed creator across detail, lists, conversations, approvals and artifacts", async () => {
    const core = await import("@workagent/core");
    const agent = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
    ))!;
    const project = (
      await call("owner", "POST", "/projects", { name: "Access regression" })
    ).json().project;
    await call("owner", "PUT", `/projects/${project.id}/members`, {
      userId: "member",
      role: "contributor",
    });
    await call("owner", "PUT", `/projects/${project.id}/members`, {
      userId: "viewer",
      role: "viewer",
    });
    const task = (
      await call("owner", "POST", `/projects/${project.id}/tasks`, {
        title: "Access run",
        assigneeId: "member",
        agentId: agent.id,
      })
    ).json().task;
    const response = await call(
      "member",
      "POST",
      `/projects/${project.id}/tasks/${task.id}/attempts`,
      { key: "access" },
    );
    expect(response.statusCode).toBe(200);
    const { run, conversation } = response.json();
    await db.query("UPDATE agent_run SET status='succeeded' WHERE id=$1", [
      run.id,
    ]);
    const key = `a/review/${run.id}/result.txt`;
    await core.putObject(key, Buffer.from("review access"));
    const artifact = (await db.one<{ id: string }>(
      "INSERT INTO artifact(run_id,name,mime_type,size,storage_key) VALUES($1,'access.txt','text/plain',13,$2) RETURNING id",
      [run.id, key],
    ))!;
    const approval = (await db.one<{ id: string }>(
      "INSERT INTO approval(run_id,tool_name,reason,input,requested_by) VALUES($1,'access','test','{}','member') RETURNING id",
      [run.id],
    ))!;
    for (const who of ["outsider", "foreign"]) {
      for (const path of [
        `/runs/${run.id}`,
        `/runs/${run.id}/events`,
        `/artifacts/${artifact.id}/download`,
        `/approvals/${approval.id}`,
        `/conversations/${conversation.id}/messages`,
      ])
        expect((await call(who, "GET", path)).statusCode, path).toBe(404);
      expect(
        (
          await call(who, "POST", `/runs/${run.id}/acceptance`, {
            decision: "accepted",
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await call(who, "GET", "/runs?scope=all"))
          .json()
          .items.some((r: { id: string }) => r.id === run.id),
      ).toBe(false);
    }
    for (const path of [
      `/runs/${run.id}`,
      `/artifacts/${artifact.id}/download`,
      `/conversations/${conversation.id}/messages`,
    ])
      expect((await call("viewer", "GET", path)).statusCode, path).toBe(200);
    await call("owner", "DELETE", `/projects/${project.id}/members/member`);
    for (const path of [
      `/runs/${run.id}`,
      `/artifacts/${artifact.id}/download`,
      `/approvals/${approval.id}`,
      `/conversations/${conversation.id}/messages`,
    ])
      expect((await call("member", "GET", path)).statusCode, path).toBe(404);
  });
  it("run idempotency fingerprints payloads, survives quota/unpublication and rolls over UTC monthly quota", async () => {
    const core = await import("@workagent/core");
    const agent = (await db.one<{ id: string }>(
      "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
    ))!;
    await db.query(
      "INSERT INTO quota(org_id,scope,scope_id,monthly_run_limit) VALUES('a','org','a',1) ON CONFLICT(org_id,scope,scope_id) DO UPDATE SET current_runs=0,current_cost_usd=0,monthly_run_limit=1",
    );
    const input = {
      orgId: "a",
      userId: "owner",
      agentId: agent.id,
      message: "fingerprint",
      idempotencyKey: randomUUID(),
    };
    const first = await core.createRun(input);
    await db.query("UPDATE agent SET status='archived' WHERE id=$1", [
      agent.id,
    ]);
    expect((await core.createRun(input)).run.id).toBe(first.run.id);
    await expect(
      core.createRun({ ...input, message: "changed" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await db.query("UPDATE agent SET status='published' WHERE id=$1", [
      agent.id,
    ]);
    await expect(
      core.createRun({ ...input, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "conflict" });
    await db.query(
      "UPDATE quota SET period_start='2020-01-01' WHERE org_id='a'",
    );
    await core.createRun({ ...input, idempotencyKey: randomUUID() });
    expect(
      (await db.one<{ current_runs: number }>(
        "SELECT current_runs FROM quota WHERE org_id='a'",
      ))!.current_runs,
    ).toBe(1);
    await db.query("UPDATE quota SET monthly_run_limit=10000 WHERE org_id='a'");
  });
  it("production provisioning creates separate audited identities and rotates/revokes all sessions", async () => {
    const core = await import("@workagent/core");
    const t = await core.provision({
      action: "tenant",
      email: "new-owner@fixture.test",
      slug: "new-fixture",
      name: "New fixture",
      password: "Fixture-password-2026!",
    });
    expect(t.orgId).toBeTruthy();
    const p = await core.provision({
      action: "platform",
      email: "new-platform@fixture.test",
      password: "Fixture-password-2026!",
    });
    expect(
      await db.one("SELECT 1 FROM membership WHERE user_id=$1", [p.userId]),
    ).toBeNull();
    const token = await core.platformLogin(
      "new-platform@fixture.test",
      "Fixture-password-2026!",
    );
    expect(await core.getPlatformSessionUser(token)).toBeTruthy();
    await core.provision({
      action: "revoke-platform",
      email: "new-platform@fixture.test",
    });
    expect(await core.getPlatformSessionUser(token)).toBeNull();
    await core.provision({
      action: "rotate",
      email: "new-owner@fixture.test",
      password: "Rotated-password-2026!",
    });
    await expect(
      core.provision({
        action: "tenant",
        email: "new-owner@fixture.test",
        slug: "duplicate",
        name: "Dup",
        password: "Fixture-password-2026!",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("real OpenAI-compatible HTTP model and embedding client executes through the queue worker with one actual tool call", async () => {
    const core = await import("@workagent/core");
    const { config } = await import("@workagent/config");
    const mutable = config as unknown as {
      useMockModel: boolean;
      modelApiKey: string;
      modelBaseUrl: string;
    };
    const saved = {
      useMockModel: mutable.useMockModel,
      modelApiKey: mutable.modelApiKey,
      modelBaseUrl: mutable.modelBaseUrl,
    };
    let toolCalls = 0,
      models = 0,
      embeddings = 0;
    const fixture = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/embeddings") {
        embeddings++;
        res.end(
          JSON.stringify({
            data: body.input
              .map((_: string, index: number) => ({
                index,
                embedding: Array.from({ length: 1536 }, (_, i) =>
                  i === 0 ? 1 : 0,
                ),
              }))
              .reverse(),
          }),
        );
        return;
      }
      if (req.url?.startsWith("/tool")) {
        toolCalls++;
        res.end(JSON.stringify({ answer: "fixture-tool-success" }));
        return;
      }
      models++;
      if (body.messages.some((m: { role: string }) => m.role === "tool"))
        res.end(
          JSON.stringify({
            choices: [
              {
                message: { content: "fixture completed" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          }),
        );
      else
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "fixture-call",
                      type: "function",
                      function: {
                        name: "fixture_lookup",
                        arguments: '{"id":"one"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 2 },
          }),
        );
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    const port = (fixture.address() as { port: number }).port;
    let worker: ReturnType<typeof core.createWorker> | undefined;
    try {
      Object.assign(mutable, {
        useMockModel: false,
        modelApiKey: "fixture-key-only",
        modelBaseUrl: `http://127.0.0.1:${port}/v1`,
      });
      const vectors = await core.embedTexts(["first", "second"]);
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toHaveLength(1536);
      const connector = (
        await call("owner", "POST", "/connectors", {
          name: "Real fixture",
          type: "http",
          baseUrl: `http://127.0.0.1:${port}`,
          authType: "none",
          tools: [
            {
              name: "fixture_lookup",
              description: "Fixture lookup",
              method: "GET",
              path: "/tool",
              inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
                additionalProperties: false,
              },
              risk: "low",
              approvalRequired: false,
            },
          ],
        })
      ).json().connector;
      await db.query("UPDATE connector SET status='active' WHERE id=$1", [
        connector.id,
      ]);
      const a = (
        await call("owner", "POST", "/agents", {
          definition: {
            name: "HTTP fixture",
            instructions: "Use fixture",
            tools: { connectorIds: [connector.id], skillIds: [] },
            approval: { mode: "never" },
          },
        })
      ).json().agent;
      expect(
        (await call("owner", "POST", `/agents/${a.id}/publish`, {})).statusCode,
      ).toBe(200);
      const result = await core.createRun({
        orgId: "a",
        userId: "owner",
        agentId: a.id,
        message: "real fixture",
        idempotencyKey: randomUUID(),
      });
      // Keep this worker's fixture isolated from earlier deliberately queued test runs.
      await db.query(
        "UPDATE outbox_event SET status='processed' WHERE status='pending' AND payload->>'runId' IS DISTINCT FROM $1",
        [result.run.id],
      );
      worker = core.createWorker({
        name: "http-fixture",
        pollMs: 10,
        concurrency: 1,
        handlers: {
          "run.execute": async (job) =>
            core.executeRun(String(job.payload.runId), job.org_id),
        },
      });
      const deadline = Date.now() + 5000;
      let detail;
      do {
        detail = await core.getRunDetail(result.run.id, "a");
        if (["succeeded", "failed"].includes(detail!.run.status)) break;
        await new Promise((r) => setTimeout(r, 20));
      } while (Date.now() < deadline);
      expect(detail!.run.status).toBe("succeeded");
      expect(detail!.run.output).toBe("fixture completed");
      expect(toolCalls).toBe(1);
      expect(models).toBe(2);
      expect(embeddings).toBe(1);
      expect(
        detail!.steps.some(
          (s) => s.kind === "tool" && s.status === "succeeded",
        ),
      ).toBe(true);
    } finally {
      await worker?.stop();
      Object.assign(mutable, saved);
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
    }
  }, 15000);
});

describe.sequential("release and execution safety regressions", () => {
  it("evaluates an unpublished draft and gates production publication on the exact compiled checksum", async () => {
    const core = await import("@workagent/core");
    const { config } = await import("@workagent/config");
    const mutable = config as unknown as { isProd: boolean };
    const created = await call("builder", "POST", "/agents", {
      definition: { name: "Release gate", instructions: "Release fixture" },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().agent.id;
    const dataset = (
      await call("builder", "POST", "/eval-datasets", {
        agentId: id,
        name: "Release cases",
      })
    ).json().dataset;
    expect(
      (
        await call("builder", "POST", `/eval-datasets/${dataset.id}/cases`, {
          name: "Case",
          input: "hello",
          assertions: [{ type: "not_contains", value: "impossible-sentinel" }],
        })
      ).statusCode,
    ).toBe(200);
    const evaluation = await call("builder", "POST", "/eval-runs", {
      datasetId: dataset.id,
    });
    expect(evaluation.statusCode).toBe(200);
    const evalId = evaluation.json().evalRun.id;
    await core.executeEvalRun(evalId, "a");
    expect(
      (await db.one<{ failed: number }>(
        "SELECT failed FROM eval_run WHERE id=$1",
        [evalId],
      ))!.failed,
    ).toBe(0);
    const saved = mutable.isProd;
    mutable.isProd = true;
    try {
      expect(
        (await call("builder", "POST", `/agents/${id}/publish`, {})).statusCode,
      ).toBe(200);
      await call("builder", "PUT", `/agents/${id}`, {
        definition: { name: "Release gate", instructions: "Changed revision" },
      });
      expect(
        (await call("builder", "POST", `/agents/${id}/publish`, {})).statusCode,
      ).toBe(409);
      expect(
        (
          await call("builder", "POST", `/agents/${id}/publish`, {
            overrideReason: "Privileged override attempt by builder",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await call("owner", "POST", `/agents/${id}/publish`, {
            overrideReason: "Reviewed emergency override fixture reason",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        await db.one(
          "SELECT id FROM audit_log WHERE resource_id=$1 AND action='agent.publish.override'",
          [id],
        ),
      ).toBeTruthy();
    } finally {
      mutable.isProd = saved;
    }
  });
  it("private Agents are hidden and cannot execute for ordinary users; public remains tenant-scoped", async () => {
    const created = await call("builder", "POST", "/agents", {
      definition: {
        name: "Private regression",
        instructions: "Private",
        visibility: "private",
      },
    });
    const id = created.json().agent.id;
    expect(
      (await call("builder", "POST", `/agents/${id}/publish`, {})).statusCode,
    ).toBe(200);
    expect(
      (await call("member", "GET", "/agents"))
        .json()
        .items.some((x: { id: string }) => x.id === id),
    ).toBe(false);
    expect(
      (
        await call("member", "POST", "/runs", {
          agentId: id,
          message: "private",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call("foreign", "POST", "/runs", {
          agentId: id,
          message: "foreign",
        })
      ).statusCode,
    ).toBe(404);
    for (const path of [
      "/runs?page=NaN",
      "/runs?page=1.5",
      "/conversations?pageSize=1000",
    ])
      expect((await call("member", "GET", path)).statusCode).toBe(400);
    const page = (
      await call("owner", "GET", "/runs?scope=all&pageSize=1")
    ).json();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
  });
  it("write transport loss halts on the first attempt, invalid input never enters the ledger, and preview never performs writes", async () => {
    const core = await import("@workagent/core");
    let writes = 0;
    const fixture = createServer((req, res) => {
      writes++;
      req.socket.destroy();
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    const port = (fixture.address() as { port: number }).port;
    try {
      const connector = (await db.one<{ id: string }>(
        "INSERT INTO connector(org_id,name,type,base_url,auth_type,status) VALUES('a','Uncertain fixture','http',$1,'none','active') RETURNING id",
        [`http://127.0.0.1:${port}`],
      ))!;
      const row = (await db.one<{
        id: string;
        agent_id: string;
        user_id: string;
      }>(
        "SELECT id,agent_id,user_id FROM agent_run WHERE org_id='a' LIMIT 1",
      ))!;
      const tool = {
        name: "write_once",
        description: "write",
        source: "http" as const,
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        risk: "high" as const,
        approvalRequired: true,
        timeoutMs: 500,
        maxRetries: 3,
        config: {
          connectorId: connector.id,
          baseUrl: `http://127.0.0.1:${port}`,
          method: "POST",
          path: "/write",
        },
      };
      const ctx = {
        orgId: "a",
        agentId: row.agent_id,
        runId: row.id,
        userId: row.user_id,
        invocationId: "uncertain-regression",
      };
      await expect(core.executeTool(tool, {}, ctx)).rejects.toMatchObject({
        code: "bad_request",
      });
      expect(
        await db.one(
          "SELECT 1 FROM tool_invocation WHERE run_id=$1 AND call_id=$2",
          [row.id, ctx.invocationId],
        ),
      ).toBeNull();
      await expect(
        core.executeTool(tool, { id: "one" }, ctx),
      ).rejects.toMatchObject({ code: "tool_outcome_unknown" });
      expect(writes).toBe(1);
      await expect(
        core.executeTool(tool, { id: "one" }, ctx),
      ).rejects.toMatchObject({ code: "tool_outcome_unknown" });
      expect(writes).toBe(1);
      const run = await core.getRunRecord(row.id, "a");
      const snapshot = structuredClone(run!.revision_bootstrap);
      snapshot.toolPlan.tools = [{ ...tool, name: "lookup_order" }];
      snapshot.definition.approval.mode = "never";
      await core.previewAgent({
        bootstrap: snapshot,
        message: "订单 A20260101",
        orgId: "a",
        userId: row.user_id,
        agentId: row.agent_id,
      });
      expect(writes).toBe(1);
    } finally {
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
    }
  });
  it("MCP returns a matching response without waiting for a long-lived SSE stream to close", async () => {
    const core = await import("@workagent/core");
    let calls = 0;
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      if (body.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      if (body.method === "initialize")
        res.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } })}\n\n`,
        );
      else {
        calls++;
        res.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: 999, result: { wrong: true } })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { ok: true } } })}\n\n`,
        );
      }
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    const port = (fixture.address() as { port: number }).port;
    try {
      const url = `http://127.0.0.1:${port}`;
      const connector = (await db.one<{ id: string }>(
        "INSERT INTO connector(org_id,name,type,mcp_url,auth_type,status) VALUES('a','Streaming MCP','mcp',$1,'none','active') RETURNING id",
        [url],
      ))!;
      const result = await core.executeTool(
        {
          name: "stream",
          description: "Stream",
          source: "mcp",
          inputSchema: { type: "object" },
          risk: "low",
          approvalRequired: false,
          timeoutMs: 1000,
          maxRetries: 0,
          config: {
            connectorId: connector.id,
            mcpUrl: url,
            toolName: "stream",
          },
        },
        {},
        { orgId: "a", userId: "owner", agentId: "fixture", runId: "fixture" },
      );
      expect(result.output).toEqual({ ok: true });
      expect(calls).toBe(1);
    } finally {
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
    }
  }, 5000);
});

it("cleanup is repeatable, bounds expiry and retains referenced artifact objects", async () => {
  const core = await import("@workagent/core");
  const { config } = await import("@workagent/config");
  const orphan = `a/retention/${randomUUID()}.txt`;
  await core.putObject(orphan, Buffer.from("orphan"));
  await fs.utimes(
    `${config.artifactDir}/${orphan}`,
    new Date("2020-01-01"),
    new Date("2020-01-01"),
  );
  const ref = (await db.one<{ storage_key: string }>(
    "SELECT storage_key FROM artifact WHERE run_id IN(SELECT id FROM agent_run WHERE org_id='a') LIMIT 1",
  ))!;
  await fs.utimes(
    `${config.artifactDir}/${ref.storage_key}`,
    new Date("2020-01-01"),
    new Date("2020-01-01"),
  );
  await db.query(
    "INSERT INTO session(org_id,user_id,token_hash,expires_at) VALUES('a','owner',$1,now()-interval '1 day')",
    [randomUUID()],
  );
  const result = await core.cleanupExpired();
  expect(result.session).toBeGreaterThan(0);
  expect(result.orphan_objects).toBeGreaterThan(0);
  await expect(core.getObject(orphan)).rejects.toThrow();
  expect(await core.getObject(ref.storage_key)).toBeTruthy();
  expect((await core.cleanupExpired()).session).toBe(0);
});

it("dead-letter retry actually resumes a failed safe run and refuses uncertain effects", async () => {
  const core = await import("@workagent/core");
  const a = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND name='Private regression'",
  ))!;
  const created = await core.createRun({
    orgId: "a",
    userId: "owner",
    agentId: a.id,
    message: "safe retry",
    idempotencyKey: randomUUID(),
  });
  await db.query(
    "UPDATE agent_run SET status='failed',error='transient' WHERE id=$1",
    [created.run.id],
  );
  const job = (await db.one<{ id: string }>(
    "UPDATE outbox_event SET status='failed',attempts=3 WHERE payload->>'runId'=$1 RETURNING id",
    [created.run.id],
  ))!;
  expect(
    (await call("owner", "POST", `/queue/${job.id}/retry`, {})).statusCode,
  ).toBe(200);
  await core.executeRun(created.run.id, "a");
  expect((await core.getRunDetail(created.run.id, "a"))!.run.status).toBe(
    "succeeded",
  );
  await db.query("UPDATE outbox_event SET status='failed' WHERE id=$1", [
    job.id,
  ]);
  expect(
    (await call("owner", "POST", `/queue/${job.id}/retry`, {})).statusCode,
  ).toBe(409);
  const uncertain = (await db.one<{ run_id: string }>(
    "SELECT run_id FROM tool_invocation WHERE status='uncertain' LIMIT 1",
  ))!;
  const id = await core.enqueue({
    orgId: "a",
    type: "run.execute",
    payload: { runId: uncertain.run_id },
  });
  await db.query("UPDATE outbox_event SET status='failed' WHERE id=$1", [id]);
  expect(
    (await call("owner", "POST", `/queue/${id}/retry`, {})).statusCode,
  ).toBe(409);
});
it("deleting a planning task preserves project provenance and denies nonmember access to its run", async () => {
  const core = await import("@workagent/core");
  const row = (await db.one<{
    id: string;
    project_id: string;
    task_id: string;
  }>(
    "SELECT r.id,r.project_id,pa.task_id FROM agent_run r JOIN project_task_attempt pa ON pa.run_id=r.id JOIN project p ON p.id=r.project_id WHERE p.created_by='owner' AND r.input LIKE 'Access run%' LIMIT 1",
  ))!;
  expect(row).toBeTruthy();
  expect(
    (
      await call(
        "owner",
        "DELETE",
        `/projects/${row.project_id}/tasks/${row.task_id}`,
      )
    ).statusCode,
  ).toBe(200);
  expect((await call("outsider", "GET", `/runs/${row.id}`)).statusCode).toBe(
    404,
  );
  expect((await call("viewer", "GET", `/runs/${row.id}`)).statusCode).toBe(200);
  await expect(
    db.query("UPDATE agent_run SET project_id=NULL WHERE id=$1", [row.id]),
  ).rejects.toThrow("immutable");
});
it("SSE applies product CORS/security headers, replays Last-Event-ID and closes on project membership removal", async () => {
  const core = await import("@workagent/core");
  const row = (await db.one<{ id: string; project_id: string }>(
    "SELECT r.id,r.project_id FROM agent_run r JOIN project_member pm ON pm.project_id=r.project_id AND pm.org_id=r.org_id WHERE pm.user_id='viewer' LIMIT 1",
  ))!;
  await core.recordEvent(row.id, {
    type: "run.status",
    runId: row.id,
    status: "succeeded",
    at: new Date().toISOString(),
  });
  const cursor = (await db.one<{ seq: number }>(
    "SELECT max(seq) AS seq FROM run_event WHERE run_id=$1",
    [row.id],
  ))!.seq;
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const replay = await fetch(`${address}/v1/runs/${row.id}/events`, {
    headers: {
      authorization: `Bearer ${tokens.viewer}`,
      origin: "http://localhost:5174",
      "Last-Event-ID": String(cursor - 1),
    },
    signal: AbortSignal.timeout(3000),
  });
  expect(replay.status).toBe(200);
  expect(replay.headers.get("access-control-allow-origin")).toBe(
    "http://localhost:5174",
  );
  expect(replay.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await replay.text()).toContain(`id: ${cursor}`);
  await db.query("UPDATE agent_run SET status='running' WHERE id=$1", [row.id]);
  const stream = await fetch(`${address}/v1/runs/${row.id}/events`, {
    headers: { authorization: `Bearer ${tokens.viewer}` },
    signal: AbortSignal.timeout(3000),
  });
  const reader = stream.body!.getReader();
  await reader.read();
  await db.query(
    "DELETE FROM project_member WHERE project_id=$1 AND user_id='viewer'",
    [row.project_id],
  );
  let done = false;
  while (!done) done = (await reader.read()).done;
  expect(done).toBe(true);
  await db.query("UPDATE agent_run SET status='succeeded' WHERE id=$1", [
    row.id,
  ]);
}, 10000);
it("task attempts roll back run/outbox/quota on association failure and concurrent retries do not increment task version", async () => {
  const agent = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
  ))!;
  const project = (
    await call("owner", "POST", "/projects", { name: "Atomic attempts" })
  ).json().project;
  const task = (
    await call("owner", "POST", `/projects/${project.id}/tasks`, {
      title: "Atomic task",
      assigneeId: "owner",
      agentId: agent.id,
    })
  ).json().task;
  const counts = () =>
    db.one(
      "SELECT (SELECT count(*) FROM agent_run)::int AS runs,(SELECT count(*) FROM outbox_event)::int AS jobs,(SELECT count(*) FROM message)::int AS messages,(SELECT current_runs FROM quota WHERE org_id='a' AND scope='org') AS quota",
    );
  const before = await counts();
  await db.query(
    "CREATE FUNCTION reject_review_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-database-fixture-details'; END $$; CREATE TRIGGER reject_review_attempt BEFORE INSERT ON project_task_attempt FOR EACH ROW EXECUTE FUNCTION reject_review_attempt()",
  );
  try {
    const failed = await call(
      "owner",
      "POST",
      `/projects/${project.id}/tasks/${task.id}/attempts`,
      { key: "atomic" },
    );
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain("private-database-fixture-details");
    expect(await counts()).toEqual(before);
  } finally {
    await db.query(
      "DROP TRIGGER reject_review_attempt ON project_task_attempt;DROP FUNCTION reject_review_attempt()",
    );
  }
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      call(
        "owner",
        "POST",
        `/projects/${project.id}/tasks/${task.id}/attempts`,
        { key: "atomic" },
      ),
    ),
  );
  expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
  expect(new Set(results.map((r) => r.json().run.id)).size).toBe(1);
  expect(
    (await db.one<{ version: number }>(
      "SELECT version FROM project_task WHERE id=$1",
      [task.id],
    ))!.version,
  ).toBe(task.version + 1);
  expect(
    (
      await call(
        "owner",
        "POST",
        `/projects/${project.id}/tasks/${task.id}/attempts`,
        { key: "another" },
      )
    ).statusCode,
  ).toBe(409);
  const core = await import("@workagent/core");
  const runId = results[0]!.json().run.id;
  await Promise.all(
    Array.from({ length: 12 }, () =>
      core.recordEvent(runId, {
        type: "run.status",
        runId,
        status: "queued",
        at: new Date().toISOString(),
      }),
    ),
  );
  const seq = await db.query<{ seq: number }>(
    "SELECT seq FROM run_event WHERE run_id=$1 ORDER BY seq",
    [runId],
  );
  expect(seq.map((r) => r.seq)).toEqual(
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
});
it("revoked project execution identity stops queued execution before model or tools", async () => {
  const core = await import("@workagent/core");
  const row = (await db.one<{ id: string; project_id: string }>(
    "SELECT r.id,r.project_id FROM agent_run r WHERE r.input LIKE 'Access run%' LIMIT 1",
  ))!;
  await db.query(
    "UPDATE agent_run SET status='queued',output=NULL WHERE id=$1",
    [row.id],
  );
  const before = (await db.one<{ n: number }>(
    "SELECT count(*)::int AS n FROM tool_invocation WHERE run_id=$1",
    [row.id],
  ))!.n;
  await core.executeRun(row.id, "a");
  const detail = await core.getRunDetail(row.id, "a");
  expect(detail!.run.status).toBe("failed");
  expect(detail!.run.error).toContain("membership revoked");
  expect(
    (await db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM tool_invocation WHERE run_id=$1",
      [row.id],
    ))!.n,
  ).toBe(before);
});
it("channel group actors have separate private conversations and a transient failure does not consume delivery", async () => {
  const core = await import("@workagent/core");
  const agent = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND status='published' AND visibility!='private' LIMIT 1",
  ))!;
  const account = await core.createChannelAccount({
    orgId: "a",
    type: "feishu",
    name: "Group fixture",
    appId: "fixture",
    appSecret: "fixture",
    verificationToken: "fixture",
    encryptKey: "fixture",
    defaultAgentId: agent.id,
  });
  for (const [externalUserId, userId] of [
    ["one", "member"],
    ["two", "owner"],
  ])
    expect(
      (
        await call("owner", "PUT", `/channels/${account.id}/bindings`, {
          externalUserId,
          userId,
        })
      ).statusCode,
    ).toBe(200);
  const input = (actor: string, event: string) => ({
    channel: "feishu" as const,
    accountId: account.id,
    externalEventId: event,
    message: {
      externalUserId: actor,
      externalUserName: actor,
      isGroup: true,
      externalConversationId: "shared-group",
      externalMessageId: event,
      text: "group fixture",
      raw: {},
    },
  });
  await db.query("UPDATE agent SET status='archived' WHERE id=$1", [agent.id]);
  await expect(
    core.processInboundMessage(input("one", "retryable-event")),
  ).rejects.toThrow();
  expect(
    await db.one("SELECT 1 FROM channel_event WHERE account_id=$1", [
      account.id,
    ]),
  ).toBeNull();
  await db.query("UPDATE agent SET status='published' WHERE id=$1", [agent.id]);
  const first = await core.processInboundMessage(
    input("one", "retryable-event"),
  );
  const second = await core.processInboundMessage(input("two", "second-event"));
  expect(first.runId).toBeTruthy();
  expect(second.runId).toBeTruthy();
  expect(
    (await core.processInboundMessage(input("one", "retryable-event")))
      .duplicate,
  ).toBe(true);
  const conversations = await db.query<{ conversation_id: string }>(
    "SELECT conversation_id FROM channel_conversation WHERE account_id=$1",
    [account.id],
  );
  expect(new Set(conversations.map((x) => x.conversation_id)).size).toBe(2);
});

// Findings 36/37: fault injection and real HTTP authorization/revocation boundaries.
it("privileged skill, connector, channel and invitation mutations roll back completely when audit fails", async () => {
  const skill = (
    await call("owner", "POST", "/skills", {
      name: "Atomic skill",
      instructions: "original",
    })
  ).json().skill;
  const connector = (
    await call("owner", "POST", "/connectors", {
      name: "Atomic connector",
      type: "http",
      baseUrl: "https://example.com",
      secret: "original-secret",
      tools: [],
    })
  ).json().connector;
  const channel = (
    await call("owner", "POST", "/channels", {
      name: "Atomic channel",
      type: "feishu",
      appSecret: "original-secret",
    })
  ).json().channel;
  expect(skill?.id).toBeTruthy();
  expect(connector?.id).toBeTruthy();
  expect(channel?.id).toBeTruthy();
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of [
      "skill",
      "connector",
      "channel_account",
      "channel_binding",
      "app_user",
      "membership",
      "audit_log",
    ])
      result[table] = await db.query(
        `SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`,
      );
    return result;
  };
  const before = await snapshot();
  await db.query(`CREATE FUNCTION fail_sensitive_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action ~ '^(skill|connector|channel|member)\\.' THEN RAISE EXCEPTION 'injected-private-audit-failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_sensitive_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_sensitive_audit()`);
  try {
    for (const [method, path, payload] of [
      ["POST", "/skills", { name: "must roll back", instructions: "new" }],
      ["PATCH", `/skills/${skill.id}`, { instructions: "changed" }],
      ["DELETE", `/skills/${skill.id}`, undefined],
      [
        "POST",
        "/connectors",
        {
          name: "must roll back",
          type: "http",
          baseUrl: "https://example.com",
          secret: "new-secret",
          tools: [],
        },
      ],
      ["PATCH", `/connectors/${connector.id}`, { secret: "changed-secret" }],
      ["DELETE", `/connectors/${connector.id}`, undefined],
      [
        "POST",
        "/channels",
        { name: "must roll back", type: "feishu", appSecret: "new-secret" },
      ],
      [
        "PATCH",
        `/channels/${channel.id}`,
        { appSecret: "changed-secret", verificationToken: "changed-token" },
      ],
      ["DELETE", `/channels/${channel.id}`, undefined],
      [
        "PUT",
        `/channels/${channel.id}/bindings`,
        { userId: "member", externalUserId: "must-roll-back" },
      ],
      [
        "POST",
        "/members",
        {
          email: "audit-rollback@test.local",
          name: "Rollback",
          role: "user",
          password: "Strong-test-password-123!",
        },
      ],
      [
        "POST",
        "/members",
        {
          email: "foreign@test.local",
          name: "Existing identity",
          role: "user",
        },
      ],
    ] as const) {
      const response = await call("owner", method, path, payload);
      expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(
        500,
      );
      expect(response.body).not.toContain("injected-private");
      expect(await snapshot(), `${method} ${path}`).toEqual(before);
    }
  } finally {
    await db.query(
      "DROP TRIGGER fail_sensitive_audit ON audit_log; DROP FUNCTION fail_sensitive_audit()",
    );
  }
});

async function mutationFixture() {
  // Separate synthetic clients keep fixture setup below the real per-IP limit.
  fixtureSubnet += 1;
  await db.query(
    "UPDATE quota SET monthly_run_limit=100000,current_runs=0,current_cost_usd=0 WHERE org_id='a'",
  );
  const agent = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND status='published' LIMIT 1",
  ))!;
  const project = (
    await call("owner", "POST", "/projects", { name: "Action authorization" })
  ).json().project;
  for (const [userId, role] of [
    ["member", "contributor"],
    ["viewer", "viewer"],
    ["outsider", "contributor"],
  ])
    expect(
      (
        await call("owner", "PUT", `/projects/${project.id}/members`, {
          userId,
          role,
        })
      ).statusCode,
    ).toBe(200);
  const task = (
    await call("owner", "POST", `/projects/${project.id}/tasks`, {
      title: "Responsible task",
      assigneeId: "member",
    })
  ).json().task;
  const core = await import("@workagent/core");
  const { run } = await core.createRun({
    orgId: "a",
    userId: "owner",
    agentId: agent.id,
    projectId: project.id,
    message: "Action authorization fixture",
  });
  await db.query(
    "INSERT INTO project_task_attempt(org_id,project_id,task_id,attempt,run_id,created_by) VALUES('a',$1,$2,1,$3,'owner')",
    [project.id, task.id, run.id],
  );
  await db.query("UPDATE agent_run SET status='waiting_approval' WHERE id=$1", [
    run.id,
  ]);
  const approval = (await db.one<{ id: string }>(
    "INSERT INTO approval(run_id,tool_name,reason,input,requested_by) VALUES($1,'action','test','{}','owner') RETURNING id",
    [run.id],
  ))!;
  return { project, task, run, approval };
}

it("project viewers and unrelated contributors may read but cannot cancel, approve or accept; responsible and manager actions succeed", async () => {
  const { project, task, run, approval } = await mutationFixture();
  for (const who of ["viewer", "outsider"]) {
    expect((await call(who, "GET", `/runs/${run.id}`)).statusCode).toBe(200);
    for (const [path, body] of [
      [`/runs/${run.id}/cancel`, {}],
      [`/approvals/${approval.id}/decide`, { decision: "approve" }],
      [`/runs/${run.id}/acceptance`, { decision: "accepted" }],
    ] as const)
      expect([403, 404]).toContain(
        (await call(who, "POST", path, body)).statusCode,
      );
  }
  expect(
    (
      await call("member", "POST", `/approvals/${approval.id}/decide`, {
        decision: "approve",
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call("member", "POST", `/runs/${run.id}/cancel`)).statusCode,
  ).toBe(200);
  const second = await mutationFixture();
  expect(
    (
      await call("owner", "POST", `/approvals/${second.approval.id}/decide`, {
        decision: "reject",
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call("owner", "POST", `/runs/${second.run.id}/cancel`)).statusCode,
  ).toBe(200);
  await db.query("UPDATE agent_run SET status='succeeded' WHERE id=$1", [
    run.id,
  ]);
  // A manager responsible for the task is still not an independent reviewer.
  await call("owner", "PUT", `/projects/${project.id}/members`, {
    userId: "member",
    role: "manager",
  });
  expect(
    (
      await call("member", "POST", `/runs/${run.id}/acceptance`, {
        decision: "accepted",
      })
    ).statusCode,
  ).toBe(403);
  await call("owner", "PUT", `/projects/${project.id}/members`, {
    userId: "outsider",
    role: "manager",
  });
  expect(
    (
      await call("outsider", "POST", `/runs/${run.id}/acceptance`, {
        decision: "accepted",
      })
    ).statusCode,
  ).toBe(200);
  // Deleted planning records deliberately leave manager-only mutation authority.
  await db.query("DELETE FROM project_task WHERE id=$1", [task.id]);
  await call("owner", "PUT", `/projects/${project.id}/members`, {
    userId: "member",
    role: "contributor",
  });
  await db.query("UPDATE agent_run SET status='queued' WHERE id=$1", [run.id]);
  expect(
    (await call("member", "POST", `/runs/${run.id}/cancel`)).statusCode,
  ).toBe(404);
  expect(
    (await call("owner", "POST", `/runs/${run.id}/cancel`)).statusCode,
  ).toBe(200);
});

// Wait for PostgreSQL to prove the request reached its transaction lock, without timing assumptions.
async function waitForBlocked(pid: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const row = await db.one(
      "SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
      [pid],
    );
    if (row) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("request did not reach expected database lock");
}

it("live tenant grants serialize sensitive mutations against role revocation", async () => {
  for (const [path, body, actor] of [
    ["/skills", { name: "revoked skill", instructions: "deny" }, "builder"],
    [
      "/connectors",
      {
        name: "revoked connector",
        type: "http",
        baseUrl: "https://example.com",
        tools: [],
      },
      "builder",
    ],
    ["/channels", { name: "revoked channel", type: "feishu" }, "outsider"],
    [
      "/members",
      { email: "revoked-invite@test.local", name: "deny", role: "user" },
      "outsider",
    ],
  ] as const) {
    const client = await db.pool.connect();
    let response: Promise<Awaited<ReturnType<typeof call>>> | undefined;
    try {
      await client.query("BEGIN");
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      await client.query(
        "UPDATE membership SET role='user' WHERE org_id='a' AND user_id=$1",
        [actor],
      );
      response = Promise.resolve(call(actor, "POST", path, body));
      await waitForBlocked(pid);
      await client.query("COMMIT");
      expect((await response).statusCode, path).toBe(403);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      if (response) await response;
      await db.query(
        "UPDATE membership SET role=$2 WHERE org_id='a' AND user_id=$1",
        [actor, actor === "builder" ? "builder" : "admin"],
      );
    }
  }
});

it("project mutation locks recheck role, project membership and active tenant membership after concurrent revocation", async () => {
  for (const action of ["cancel", "approval", "acceptance"] as const) {
    for (const revoke of ["role", "project", "tenant"] as const) {
      const f = await mutationFixture();
      const grant = await call(
        "owner",
        "PUT",
        `/projects/${f.project.id}/members`,
        {
          userId: "outsider",
          role: "manager",
        },
      );
      expect(grant.statusCode, `${action}/${revoke}: ${grant.body}`).toBe(200);
      if (action === "acceptance")
        await db.query("UPDATE agent_run SET status='succeeded' WHERE id=$1", [
          f.run.id,
        ]);
      const client = await db.pool.connect();
      let response: Promise<Awaited<ReturnType<typeof call>>> | undefined;
      try {
        await client.query("BEGIN");
        const pid = (await client.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        await client.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [
          f.project.id,
        ]);
        if (revoke === "role")
          await client.query(
            "UPDATE project_member SET role='viewer' WHERE project_id=$1 AND user_id='outsider'",
            [f.project.id],
          );
        if (revoke === "project")
          await client.query(
            "DELETE FROM project_member WHERE project_id=$1 AND user_id='outsider'",
            [f.project.id],
          );
        if (revoke === "tenant")
          await client.query(
            "UPDATE membership SET status='disabled' WHERE org_id='a' AND user_id='outsider'",
          );
        const path =
          action === "approval"
            ? `/approvals/${f.approval.id}/decide`
            : `/runs/${f.run.id}/${action}`;
        response = Promise.resolve(
          call(
            "outsider",
            "POST",
            path,
            action === "approval"
              ? { decision: "approve" }
              : action === "acceptance"
                ? { decision: "accepted" }
                : {},
          ),
        );
        await Promise.race([
          waitForBlocked(pid),
          response.then((r) => {
            throw new Error(
              `${action}/${revoke} returned early: ${r.statusCode} ${r.body}`,
            );
          }),
        ]);
        await client.query("COMMIT");
        expect([403, 404]).toContain((await response).statusCode);
        expect(
          (await db.one<{ status: string }>(
            "SELECT status FROM agent_run WHERE id=$1",
            [f.run.id],
          ))!.status,
        ).toBe(action === "acceptance" ? "succeeded" : "waiting_approval");
        expect(
          (await db.one<{ status: string }>(
            "SELECT status FROM approval WHERE id=$1",
            [f.approval.id],
          ))!.status,
        ).toBe("pending");
        expect(
          await db.one("SELECT 1 FROM run_acceptance WHERE run_id=$1", [
            f.run.id,
          ]),
        ).toBeNull();
      } finally {
        await client.query("ROLLBACK");
        client.release();
        if (response) await response;
        await db.query(
          "UPDATE membership SET status='active' WHERE org_id='a' AND user_id='outsider'",
        );
      }
    }
  }
}, 20000);

describe.sequential("product recovery lifecycle and read isolation", () => {
  let platformToken: string;
  let createdOrg: string;
  const input = {
    name: "Recovery tenant",
    slug: "recovery-tenant",
    plan: "team",
    ownerName: "Recovery owner",
    ownerEmail: "recovery-owner@test.local",
    ownerPassword: "Recovery-Owner-2026!",
  };
  const platform = (
    method: "GET" | "POST" | "PATCH",
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/v1/platform${path}`,
      headers: { authorization: `Bearer ${platformToken}` },
      ...(payload ? { payload } : {}),
      remoteAddress: "127.5.1.20",
    });
  it("creates owner atomically without granting platform or attaching existing identity", async () => {
    const core = await import("@workagent/core");
    await db.query(
      "INSERT INTO platform_admin(user_id) VALUES('owner') ON CONFLICT DO NOTHING",
    );
    platformToken = randomUUID();
    await db.query(
      "INSERT INTO platform_session(token_hash,user_id,expires_at) VALUES($1,'owner',now()+interval '1 hour')",
      [core.sha256(platformToken)],
    );
    const result = await platform("POST", "/tenants", input);
    expect(result.statusCode).toBe(201);
    expect(Object.keys(result.json()).sort()).toEqual(["orgId", "ownerId"]);
    expect(result.body).not.toContain(input.ownerPassword);
    createdOrg = result.json().orgId;
    const logged = await core.login(input.ownerEmail, input.ownerPassword);
    expect(logged.user.orgId).toBe(createdOrg);
    expect(logged.user.role).toBe("owner");
    expect(
      await db.one("SELECT * FROM platform_admin WHERE user_id=$1", [
        logged.user.id,
      ]),
    ).toBeNull();
    const ownerPlatform = await app.inject({
      method: "GET",
      url: "/v1/platform/tenants",
      headers: { authorization: `Bearer ${logged.token}` },
    });
    expect([401, 403]).toContain(ownerPlatform.statusCode);
    const ownerOrg = await app.inject({
      method: "GET",
      url: "/v1/org",
      headers: { authorization: `Bearer ${logged.token}` },
    });
    expect(ownerOrg.json().org.id).toBe(createdOrg);
    const cross = await app.inject({
      method: "GET",
      url: `/v1/projects/${p1}`,
      headers: { authorization: `Bearer ${logged.token}` },
    });
    expect(cross.statusCode).toBe(404);
    const audit = await db.one<{ metadata: object }>(
      "SELECT metadata FROM platform_audit WHERE org_id=$1 AND action='tenant.create'",
      [createdOrg],
    );
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(input.ownerPassword);
  });
  it("validates UTF-8 bytes, rejects duplicates with 409 and rolls back newly inserted org", async () => {
    expect(
      (
        await platform("POST", "/tenants", {
          ...input,
          slug: "byte-check",
          ownerPassword: "密".repeat(25),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await platform("POST", "/tenants", { ...input, slug: "bad space" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await platform("POST", "/tenants", {
          ...input,
          slug: "rollback-existing-email",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await db.one("SELECT id FROM org WHERE slug='rollback-existing-email'"),
    ).toBeNull();
    expect(
      (
        await platform("POST", "/tenants", {
          ...input,
          ownerEmail: "unused-recovery@test.local",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await db.one(
        "SELECT id FROM app_user WHERE email='unused-recovery@test.local'",
      ),
    ).toBeNull();
    const results = await Promise.all(
      [1, 2].map(() =>
        platform("POST", "/tenants", {
          ...input,
          slug: "concurrent-recovery",
          ownerEmail: "concurrent-recovery@test.local",
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });
  it("rolls back owner, membership, quota and org if the audit cannot commit", async () => {
    await db.query(
      `CREATE FUNCTION recovery_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenant.create' AND NEW.metadata->>'slug'='audit-rollback' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER recovery_fail BEFORE INSERT ON platform_audit FOR EACH ROW EXECUTE FUNCTION recovery_audit_failure()`,
    );
    try {
      expect(
        (
          await platform("POST", "/tenants", {
            ...input,
            slug: "audit-rollback",
            ownerEmail: "audit-rollback@test.local",
          })
        ).statusCode,
      ).toBe(500);
      expect(
        await db.one("SELECT id FROM org WHERE slug='audit-rollback'"),
      ).toBeNull();
      expect(
        await db.one(
          "SELECT id FROM app_user WHERE email='audit-rollback@test.local'",
        ),
      ).toBeNull();
    } finally {
      await db.query(
        "DROP TRIGGER recovery_fail ON platform_audit; DROP FUNCTION recovery_audit_failure()",
      );
    }
  });
  it("provides bounded literal search and aggregates/configuration with no private content", async () => {
    expect((await platform("GET", "/tenants?pageSize=101")).statusCode).toBe(
      400,
    );
    expect((await platform("GET", "/tenants?page=NaN")).statusCode).toBe(400);
    const list = await platform(
      "GET",
      "/tenants?search=recovery-tenant&pageSize=1",
    );
    expect(list.json().items).toHaveLength(1);
    expect(list.json().total).toBe(1);
    expect(
      (await platform("GET", "/tenants?search=%25")).json().items,
    ).toHaveLength(0);
    const detail = await platform("GET", `/tenants/${createdOrg}`);
    expect(detail.statusCode).toBe(200);
    expect(Object.keys(detail.json().tenant).sort()).toEqual(
      [
        "id",
        "name",
        "slug",
        "plan",
        "createdAt",
        "activeMemberCount",
        "agentCount",
        "runCount",
        "storageBytes",
        "costUsd",
      ].sort(),
    );
    expect(
      (
        await platform("PATCH", `/tenants/${createdOrg}`, {
          name: "Recovery configured",
          plan: "enterprise",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await platform("GET", `/tenants/${createdOrg}`)).json().tenant.plan,
    ).toBe("enterprise");
    expect(
      (
        await platform("PATCH", `/tenants/${createdOrg}`, {
          name: "Unsafe",
          plan: "team",
          suspended: true,
        })
      ).statusCode,
    ).toBe(400);
    const audit = await platform("GET", "/audit");
    expect(audit.statusCode).toBe(200);
    expect(audit.body).not.toContain(input.ownerPassword);
    await db.query("DELETE FROM platform_admin WHERE user_id='owner'");
    expect(
      (
        await platform("PATCH", `/tenants/${createdOrg}`, {
          name: "Revoked",
          plan: "team",
        })
      ).statusCode,
    ).toBe(401);
  });
  it("holds the live platform grant through owner creation and audit commit", async () => {
    await db.query("INSERT INTO platform_admin(user_id) VALUES('owner')");
    const gate = 78123456;
    const blocker = await db.pool.connect();
    const revoker = await db.pool.connect();
    await blocker.query("SELECT pg_advisory_lock($1)", [gate]);
    await db.query(
      `CREATE FUNCTION recovery_grant_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenant.create' AND NEW.metadata->>'slug'='grant-lock' THEN PERFORM pg_advisory_xact_lock(${gate}); END IF; RETURN NEW; END $$; CREATE TRIGGER recovery_grant_gate BEFORE INSERT ON platform_audit FOR EACH ROW EXECUTE FUNCTION recovery_grant_gate()`,
    );
    const pending = platform("POST", "/tenants", {
      ...input,
      slug: "grant-lock",
      ownerEmail: "grant-lock@test.local",
    });
    // Start inject immediately; wait for its transaction to reach the audit barrier.
    const resultPromise = Promise.resolve(pending);
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const row = await db.one<{ waiting: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted) AS waiting",
          [gate],
        );
        if (row?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await revoker.query("SET statement_timeout=100");
      await expect(
        revoker.query("DELETE FROM platform_admin WHERE user_id='owner'"),
      ).rejects.toMatchObject({ code: "57014" });
      await blocker.query("SELECT pg_advisory_unlock($1)", [gate]);
      expect((await resultPromise).statusCode).toBe(201);
      await revoker.query("DELETE FROM platform_admin WHERE user_id='owner'");
      expect(
        (
          await platform("POST", "/tenants", {
            ...input,
            slug: "revoked-race",
            ownerEmail: "revoked-race@test.local",
          })
        ).statusCode,
      ).toBe(401);
      expect(
        await db.one("SELECT id FROM org WHERE slug='revoked-race'"),
      ).toBeNull();
    } finally {
      await blocker.query("SELECT pg_advisory_unlock($1)", [gate]);
      await revoker.query("RESET statement_timeout");
      await resultPromise;
      blocker.release();
      revoker.release();
      await db.query(
        "DROP TRIGGER recovery_grant_gate ON platform_audit; DROP FUNCTION recovery_grant_gate()",
      );
    }
  });
  it("tenant home respects org, live role and explicit project membership", async () => {
    expect((await call("member", "GET", "/tenant-home")).statusCode).toBe(403);
    const home = await call("builder", "GET", "/tenant-home");
    expect(home.statusCode).toBe(200);
    const ownRecent = home.json().recent as { id: string }[];
    for (const r of ownRecent) {
      expect((await call("builder", "GET", `/runs/${r.id}`)).statusCode).toBe(
        200,
      );
    }
    const foreign = await call("foreign", "GET", "/tenant-home");
    expect(foreign.statusCode).toBe(200);
    for (const r of foreign.json().recent) {
      const row = await db.one<{ org_id: string }>(
        "SELECT org_id FROM agent_run WHERE id=$1",
        [r.id],
      );
      expect(row?.org_id).toBe("b");
    }
    expect(home.json().readiness.verifiedChannels).toBeNull();
    expect(JSON.stringify(home.json())).not.toMatch(
      /apiKey|app_secret|password_hash/,
    );
  });
});

it("project activity remains membership scoped and run capabilities reflect server grants", async () => {
  const result = await call("owner", "POST", "/projects", {
    name: "Recovery activity",
  });
  expect(result.statusCode).toBe(201);
  const id = result.json().project.id;
  await call("owner", "POST", `/projects/${id}/tasks`, {
    title: "Audit entry",
    description: "",
    assigneeId: "owner",
    agentId: null,
  });
  const activity = await call("owner", "GET", `/projects/${id}/activity`);
  expect(activity.statusCode).toBe(200);
  expect(
    activity
      .json()
      .items.some(
        (a: { action: string }) => a.action === "project.task.create",
      ),
  ).toBe(true);
  for (const who of ["outsider", "foreign", "audit"]) {
    expect(
      (await call(who, "GET", `/projects/${id}/activity`)).statusCode,
    ).toBe(404);
  }
  const run = await db.one<{ id: string }>(
    "SELECT id FROM agent_run WHERE org_id='a' AND project_id IS NULL AND user_id='owner' LIMIT 1",
  );
  expect(run).toBeTruthy();
  const owner = await call("owner", "GET", `/runs/${run!.id}`);
  expect(owner.statusCode).toBe(200);
  expect(owner.json().capabilities.canWrite).toBe(true);
  expect(owner.json().capabilities.canAccept).toBe(false);
  expect((await call("foreign", "GET", `/runs/${run!.id}`)).statusCode).toBe(
    404,
  );
});

// Personal assistants intentionally use no enterprise attachment/catalog endpoints.
describe.sequential("personal Portal ownership and safe release", () => {
  let id: string;
  let runId: string;
  const profile = {
    name: "Private fixture partner",
    avatar: "leaf",
    purpose: "PRIVATE duties: review requirements",
    preferences: "PRIVATE preference: ask before guessing",
  };
  it("ordinary employee concurrently provisions one primary and compiles real instructions", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        call("member", "POST", "/personal-assistant", profile),
      ),
    );
    for (const r of responses) expect(r.statusCode, r.body).toBe(200);
    id = responses[0]!.json().id;
    expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
    const rows = await db.query(
      "SELECT * FROM agent_revision WHERE agent_id=$1",
      [id],
    );
    expect(rows).toHaveLength(1);
    const bootstrap = rows[0]!.bootstrap as {
      systemPrompt: string;
      toolPlan: { tools: unknown[] };
      definition: { approval: { mode: string } };
    };
    expect(bootstrap.systemPrompt).toContain(profile.preferences);
    expect(bootstrap.toolPlan.tools).toEqual([]);
    expect(bootstrap.definition.approval.mode).toBe("always");
    expect((await call("member", "GET", `/agents/${id}`)).statusCode).toBe(200);
  });
  it("serves own actual revisions but keeps enterprise catalog projections separate", async () => {
    const detail = (await call("member", "GET", `/agents/${id}`)).json();
    expect(detail.agent.personal).toBe(true);
    expect(detail.published.bootstrap.systemPrompt).toContain(
      profile.preferences,
    );
    expect(detail.draft).toBeNull();
    expect(
      (await call("member", "GET", "/agents?scope=enterprise"))
        .json()
        .items.some((a: { id: string }) => a.id === id),
    ).toBe(false);
  });
  it("updates identity atomically, creates immutable active revisions and rejects forged attachments", async () => {
    const update = await call("member", "PUT", "/personal-assistant", {
      ...profile,
      name: "Updated private partner",
    });
    expect(update.statusCode, update.body).toBe(200);
    expect(
      (await call("member", "GET", "/personal-assistant")).json().agent
        .activeVersion,
    ).toBe(2);
    for (const extra of [
      { knowledge: [{ spaceId: "arbitrary-org-space" }] },
      { tools: { skillIds: ["forged"], connectorIds: ["secret"] } },
      { ownerId: "outsider" },
      { visibility: "org" },
      { preferences: "x".repeat(4001) },
    ])
      expect(
        (
          await call("member", "PUT", "/personal-assistant", {
            ...profile,
            ...extra,
          })
        ).statusCode,
      ).toBe(400);
    for (const who of ["outsider", "foreign", "viewer"]) {
      expect(
        (await call(who, "GET", "/personal-assistant")).json().agent,
      ).toBeNull();
      expect((await call(who, "GET", `/agents/${id}`)).statusCode).not.toBe(
        200,
      );
      expect(
        (await call(who, "GET", "/agents"))
          .json()
          .items.some((a: { id: string }) => a.id === id),
      ).toBe(false);
      expect(
        (await call(who, "POST", "/runs", { agentId: id, message: "forged" }))
          .statusCode,
      ).toBe(404);
    }
    for (const path of [`/agents/${id}/publish`, `/agents/${id}/preview`])
      expect(
        (
          await call("outsider", "POST", path, {
            message: "steal",
            overrideReason: "try to bypass safe publication",
          })
        ).statusCode,
      ).toBe(404);
    expect(
      (
        await call("outsider", "PUT", `/agents/${id}`, {
          definition: {
            name: "steal",
            instructions: "steal",
            knowledge: [{ spaceId: "forged" }],
          },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call("outsider", "POST", "/eval-datasets", {
          agentId: id,
          name: "steal",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call("outsider", "POST", "/channels", {
          type: "mock",
          name: "steal",
          defaultAgentId: id,
        })
      ).statusCode,
    ).toBe(404);
    await expect(
      db.query(
        "UPDATE agent SET personal_owner_id='outsider',created_by='outsider' WHERE id=$1",
        [id],
      ),
    ).rejects.toThrow("immutable");
  });
  it("keeps employee knowledge/skill access closed and rejects alternate personal publication paths", async () => {
    for (const path of [
      "/knowledge-spaces",
      "/knowledge-spaces/forged/documents",
      "/documents/forged",
      "/skills",
      "/connectors",
    ]) {
      expect((await call("member", "GET", path)).statusCode, path).toBe(403);
    }
    expect(
      (await call("member", "POST", `/agents/${id}/publish`, {})).statusCode,
    ).toBe(403);
    const revision = (await db.one<{ definition: Record<string, unknown> }>(
      "SELECT definition FROM agent_revision WHERE agent_id=$1 AND status='published'",
      [id],
    ))!;
    for (const forged of [
      { ...revision.definition, knowledge: [{ spaceId: "forged" }] },
      {
        ...revision.definition,
        tools: { skillIds: ["forged"], connectorIds: [] },
      },
      { ...revision.definition, approval: { mode: "never" } },
    ]) {
      await expect(
        db.query(
          "INSERT INTO agent_revision(agent_id,version,status,definition,created_by) VALUES($1,99,'draft',$2,'member')",
          [id, JSON.stringify(forged)],
        ),
      ).rejects.toThrow("text-only");
    }
  });
  it("runs owned assistant with actual HTTP provider, worker engine and private usage", async () => {
    const { config } = await import("@workagent/config");
    const mutable = config as unknown as {
      useMockModel: boolean;
      modelApiKey: string;
      modelBaseUrl: string;
    };
    const saved = {
      useMockModel: mutable.useMockModel,
      modelApiKey: mutable.modelApiKey,
      modelBaseUrl: mutable.modelBaseUrl,
    };
    let prompt = "";
    const fixture = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      prompt = body;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "personal-fixture",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Personal fixture result",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 32, completion_tokens: 8 },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      fixture.listen(0, "127.0.0.1", resolve),
    );
    try {
      Object.assign(mutable, {
        useMockModel: false,
        modelApiKey: "isolated-http-fixture-only",
        modelBaseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
      });
      const response = await call("member", "POST", "/runs", {
        agentId: id,
        message: "Please review this requirement",
      });
      expect(response.statusCode, response.body).toBe(200);
      runId = response.json().run.id;
      const { executeRun } = await import("@workagent/core");
      await executeRun(runId, "a");
      expect(prompt).toContain(profile.preferences);
      expect(
        (await call("member", "GET", `/runs/${runId}`)).json().run.status,
      ).toBe("succeeded");
      expect(
        (await call("member", "GET", "/personal-usage"))
          .json()
          .items.some((r: { runId: string }) => r.runId === runId),
      ).toBe(true);
      for (const who of ["outsider", "foreign", "viewer"]) {
        expect((await call(who, "GET", `/runs/${runId}`)).statusCode).toBe(404);
        expect(
          (await call(who, "GET", "/personal-usage?userId=member"))
            .json()
            .items.some((r: { runId: string }) => r.runId === runId),
        ).toBe(false);
        expect(
          (await call(who, "GET", "/runs?scope=all"))
            .json()
            .items.some((r: { id: string }) => r.id === runId),
        ).toBe(false);
      }
      expect((await call("outsider", "GET", "/usage")).body).not.toContain(
        "Updated private partner",
      );
    } finally {
      Object.assign(mutable, saved);
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
    }
  });
  it("rolls back on audit failure and enforces revoked employee identity at execution", async () => {
    const before = (await call("member", "GET", "/personal-assistant")).json()
      .agent;
    await db.query(
      "CREATE FUNCTION reject_personal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal.update' THEN RAISE EXCEPTION 'audit fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_personal_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_personal_audit()",
    );
    try {
      expect(
        (
          await call("member", "PUT", "/personal-assistant", {
            ...profile,
            name: "must rollback",
          })
        ).statusCode,
      ).toBe(500);
    } finally {
      await db.query(
        "DROP TRIGGER reject_personal_audit ON audit_log; DROP FUNCTION reject_personal_audit()",
      );
    }
    expect(
      (await call("member", "GET", "/personal-assistant")).json().agent,
    ).toEqual(before);
    const queued = await call("member", "POST", "/runs", {
      agentId: id,
      message: "revocation fixture",
    });
    expect(queued.statusCode, queued.body).toBe(200);
    await db.query(
      "UPDATE membership SET status='disabled' WHERE org_id='a' AND user_id='member'",
    );
    try {
      expect(
        (await call("member", "PUT", "/personal-assistant", profile))
          .statusCode,
      ).toBe(401);
      const { executeRun } = await import("@workagent/core");
      await executeRun(queued.json().run.id, "a");
      expect(
        (await db.one<{ status: string }>(
          "SELECT status FROM agent_run WHERE id=$1",
          [queued.json().run.id],
        ))!.status,
      ).toBe("failed");
    } finally {
      await db.query(
        "UPDATE membership SET status='active' WHERE org_id='a' AND user_id='member'",
      );
    }
  });
});

it("project execution read models bind membership, immutable provenance and real pagination", async () => {
  const project = (
    await call("owner", "POST", "/projects", {
      name: "Scoped execution directory",
    })
  ).json().project;
  const other = (
    await call("owner", "POST", "/projects", { name: "Different directory" })
  ).json().project;
  await call("owner", "PUT", `/projects/${project.id}/members`, {
    userId: "viewer",
    role: "viewer",
  });
  const agent = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND status='published' AND personal_owner_id IS NULL LIMIT 1",
  ))!;
  const human = await call("owner", "POST", `/projects/${project.id}/tasks`, {
    title: "Human without model or Agent",
  });
  expect(human.statusCode, human.body).toBe(201);
  expect(human.json().task.agent_id).toBeNull();
  const privateAgent = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND personal_owner_id='member'",
  ))!;
  expect(privateAgent).toBeTruthy();
  await call("owner", "PUT", `/projects/${project.id}/members`, {
    userId: "member",
    role: "contributor",
  });
  for (const who of ["owner", "member"]) {
    expect(
      (
        await call(who, "POST", `/projects/${project.id}/tasks`, {
          title: "Unsafe personal sharing",
          assigneeId: "member",
          agentId: privateAgent.id,
        })
      ).statusCode,
    ).toBe(404);
  }
  await call("owner", "DELETE", `/projects/${project.id}/members/member`);

  const taskResponse = await call(
    "owner",
    "POST",
    `/projects/${project.id}/tasks`,
    { title: "Durable planning", assigneeId: "owner", agentId: agent.id },
  );
  expect(taskResponse.statusCode, taskResponse.body).toBe(201);
  const task = taskResponse.json().task;
  const attempt = await call(
    "owner",
    "POST",
    `/projects/${project.id}/tasks/${task.id}/attempts`,
    { key: "scoped-read" },
  );
  expect(attempt.statusCode, attempt.body).toBe(200);
  const run = attempt.json().run;
  await db.query(
    "UPDATE agent_run SET status='succeeded',output='Scoped actual output' WHERE id=$1",
    [run.id],
  );
  const artifact = (await db.one<{ id: string }>(
    "INSERT INTO artifact(run_id,name,storage_key) VALUES($1,'scoped.txt','isolated/scoped') RETURNING id",
    [run.id],
  ))!;
  const approval = (await db.one<{ id: string }>(
    "INSERT INTO approval(run_id,tool_name,requested_by) VALUES($1,'scope_test','owner') RETURNING id",
    [run.id],
  ))!;
  for (const [kind, entryId] of [
    ["runs", run.id],
    ["artifacts", artifact.id],
    ["approvals", approval.id],
  ]) {
    for (const who of ["owner", "viewer"]) {
      const result = await call(
        who,
        "GET",
        `/projects/${project.id}/${kind}?pageSize=1`,
      );
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().total).toBe(1);
      expect(result.json().items[0]).toMatchObject({
        id: entryId,
        taskId: task.id,
        taskTitle: task.title,
      });
      expect(
        (
          await call(
            who,
            "GET",
            `/projects/${project.id}/${kind}?page=2&pageSize=1`,
          )
        ).json().items,
      ).toEqual([]);
    }
    expect(
      (await call("owner", "GET", `/projects/${other.id}/${kind}`)).json()
        .items,
    ).toEqual([]);
    for (const who of ["outsider", "foreign", "disabled", "member"])
      expect(
        (await call(who, "GET", `/projects/${project.id}/${kind}`)).statusCode,
      ).not.toBe(200);
    expect(
      (
        await call(
          "owner",
          "GET",
          `/projects/${project.id}/${kind}?pageSize=101`,
        )
      ).statusCode,
    ).toBe(400);
  }
  expect((await call("owner", "GET", `/runs/${run.id}`)).json()).toMatchObject({
    run: { projectId: project.id },
    task: { id: task.id },
  });
  expect(
    (
      await call(
        "owner",
        "GET",
        `/projects/${other.id}/tasks/${task.id}/references`,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (await call("owner", "GET", "/runs?personal=true&pageSize=100"))
      .json()
      .items.some((r: { id: string }) => r.id === run.id),
  ).toBe(false);
  expect(
    (await call("owner", "DELETE", `/projects/${project.id}/tasks/${task.id}`))
      .statusCode,
  ).toBe(200);
  for (const kind of ["runs", "artifacts", "approvals"]) {
    const result = await call(
      "owner",
      "GET",
      `/projects/${project.id}/${kind}`,
    );
    expect(result.json().items).toHaveLength(1);
    expect(result.json().items[0].taskId).toBeNull();
  }
  await call("owner", "DELETE", `/projects/${project.id}/members/viewer`);
  for (const kind of ["runs", "artifacts", "approvals"])
    expect(
      (await call("viewer", "GET", `/projects/${project.id}/${kind}`))
        .statusCode,
    ).toBe(404);
});

it("bootstraps one real private default per org/user concurrently, protects ownership and rolls back audit failure", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => call("builder", "GET", "/projects")),
  );
  const ids = results.map(
    (r) =>
      r.json().items.filter((p: { is_default: boolean }) => p.is_default)[0].id,
  );
  expect(new Set(ids).size).toBe(1);
  const id = ids[0];
  expect(
    (await call("builder", "GET", `/projects/${id}/members`)).json().items,
  ).toMatchObject([{ user_id: "builder", role: "manager" }]);
  for (const who of ["owner", "outsider", "foreign", "member"]) {
    expect((await call(who, "GET", `/projects/${id}`)).statusCode).toBe(404);
    expect(
      (await call(who, "GET", "/projects"))
        .json()
        .items.some((p: { id: string }) => p.id === id),
    ).toBe(false);
  }
  expect(
    (
      await call("builder", "PUT", `/projects/${id}/members`, {
        userId: "owner",
        role: "manager",
      })
    ).statusCode,
  ).toBe(403);
  for (const path of [
    `/projects/${id}/members/owner`,
    `/projects/${id}/members/builder`,
  ])
    expect((await call("builder", "DELETE", path)).statusCode).toBe(403);
  expect(
    (
      await call("builder", "POST", `/projects/${id}/transfer`, {
        userId: "owner",
      })
    ).statusCode,
  ).not.toBe(200);
  for (const sql of [
    "UPDATE project SET created_by='owner' WHERE id=$1",
    "UPDATE project SET is_default=false WHERE id=$1",
    "DELETE FROM project WHERE id=$1",
    "DELETE FROM project_member WHERE project_id=$1",
    "INSERT INTO project_member(org_id,project_id,user_id,role) VALUES('a',$1,'owner','manager')",
  ])
    await expect(db.query(sql, [id])).rejects.toThrow();
  await db.query(
    "INSERT INTO app_user(id,email,name,password_hash) VALUES('bootstrap','bootstrap@test.local','bootstrap','unused')",
  );
  await db.query(
    "INSERT INTO membership(org_id,user_id,role,status) VALUES('a','bootstrap','user','active'),('b','bootstrap','user','active')",
  );
  const core = await import("@workagent/core");
  const u = {
    id: "bootstrap",
    orgId: "a",
    role: "user",
  } as import("@workagent/core").AuthUser;
  await db.query(
    `CREATE FUNCTION reject_default_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='project.default.create' AND NEW.actor_id='bootstrap' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_default_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_default_audit()`,
  );
  await expect(core.ensureDefaultProject(u)).rejects.toThrow("audit failed");
  await expect(
    core.savePersonalAssistant(
      u,
      { name: "Private", avatar: "spark", purpose: "Work", preferences: "" },
      true,
    ),
  ).rejects.toThrow("audit failed");
  expect(
    await db.one("SELECT id FROM project WHERE created_by='bootstrap'"),
  ).toBeNull();
  expect(
    await db.one("SELECT id FROM agent WHERE personal_owner_id='bootstrap'"),
  ).toBeNull();
  await db.query(
    "DROP TRIGGER reject_default_audit ON audit_log; DROP FUNCTION reject_default_audit()",
  );
  // Failure after default creation and compilation must roll the entire provision back.
  await db.query(
    `CREATE FUNCTION reject_provision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal.provision' AND NEW.actor_id='bootstrap' THEN RAISE EXCEPTION 'late provision failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_provision_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_provision_audit()`,
  );
  try {
    await expect(
      core.savePersonalAssistant(
        u,
        { name: "Private", avatar: "spark", purpose: "Work", preferences: "" },
        true,
      ),
    ).rejects.toThrow("late provision failure");
    expect(
      await db.one("SELECT id FROM project WHERE created_by='bootstrap'"),
    ).toBeNull();
    expect(
      await db.one("SELECT id FROM agent WHERE personal_owner_id='bootstrap'"),
    ).toBeNull();
  } finally {
    await db.query(
      "DROP TRIGGER reject_provision_audit ON audit_log; DROP FUNCTION reject_provision_audit()",
    );
  }
  const provisioned = await Promise.all(
    Array.from({ length: 4 }, () =>
      core.savePersonalAssistant(
        u,
        { name: "Private", avatar: "spark", purpose: "Work", preferences: "" },
        true,
      ),
    ),
  );
  expect(new Set(provisioned.map((x) => x.id)).size).toBe(1);
  expect(
    await db.query(
      "SELECT id FROM project WHERE org_id='a' AND created_by='bootstrap' AND is_default",
    ),
  ).toHaveLength(1);
  const a = await core.ensureDefaultProject(u);
  const b = await core.ensureDefaultProject({ ...u, orgId: "b" });
  expect(a.id).not.toBe(b.id);
  expect((await core.ensureDefaultProject(u)).id).toBe(a.id);
  // Recreate a pre-014 provisioned identity: its Agent exists but no default yet.
  // This fixture-only deletion is never part of the product bootstrap path.
  await db.query(
    "ALTER TABLE project_member DISABLE TRIGGER default_project_members; ALTER TABLE project DISABLE TRIGGER default_project_immutable",
  );
  try {
    await db.query("DELETE FROM project_member WHERE project_id=$1", [a.id]);
    await db.query("DELETE FROM project WHERE id=$1", [a.id]);
  } finally {
    await db.query(
      "ALTER TABLE project_member ENABLE TRIGGER default_project_members; ALTER TABLE project ENABLE TRIGGER default_project_immutable",
    );
  }
  tokens.bootstrap = randomUUID();
  await db.query(
    "INSERT INTO session(org_id,user_id,token_hash,expires_at) VALUES('a','bootstrap',$1,now()+interval '1 hour')",
    [core.sha256(tokens.bootstrap)],
  );
  const restored = await call("bootstrap", "GET", "/personal-assistant");
  expect(restored.statusCode, restored.body).toBe(200);
  expect(restored.json().agent.id).toBe(provisioned[0]!.id);
  const listed = await Promise.all(
    Array.from({ length: 4 }, () => call("bootstrap", "GET", "/projects")),
  );
  const restoredIds = listed.map(
    (r) => r.json().items.find((p: { is_default: boolean }) => p.is_default).id,
  );
  expect(new Set(restoredIds).size).toBe(1);
  expect(restoredIds[0]).not.toBe(a.id);
  expect(
    await db.query(
      "SELECT * FROM project_member WHERE org_id='a' AND project_id=$1",
      [restoredIds[0]],
    ),
  ).toMatchObject([{ user_id: "bootstrap", role: "manager" }]);
});

it("default fallback pages/counts real unassigned owner records without changing provenance or including shared/foreign executions", async () => {
  const defaults = (await call("member", "GET", "/projects")).json().items;
  const id = defaults.find((p: { is_default: boolean }) => p.is_default).id;
  const privateAgent = (await db.one<{ id: string }>(
    "SELECT id FROM agent WHERE org_id='a' AND personal_owner_id='member'",
  ))!;
  const core = await import("@workagent/core");
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const res = await call("member", "POST", "/runs", {
      agentId: privateAgent.id,
      message: `Default fallback ${i}`,
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode, res.body).toBe(200);
    runs.push(res.json().run.id);
    await db.query(
      "INSERT INTO artifact(run_id,name,mime_type,size,storage_key) VALUES($1,'private.txt','text/plain',1,'private-test')",
      [res.json().run.id],
    );
    await db.query(
      "INSERT INTO approval(run_id,tool_name,requested_by) VALUES($1,'private','member')",
      [res.json().run.id],
    );
  }
  for (const kind of ["runs", "artifacts", "approvals"]) {
    const source =
      kind === "runs"
        ? "agent_run r"
        : `${kind === "artifacts" ? "artifact" : "approval"} x JOIN agent_run r ON r.id=x.run_id`;
    const alias = kind === "runs" ? "r" : "x";
    const expected = await db.query<{ id: string }>(
      `SELECT ${alias}.id FROM ${source} WHERE r.org_id='a' AND r.user_id='member' AND r.project_id IS NULL ORDER BY ${alias}.created_at DESC,${alias}.id DESC`,
    );
    const seen: string[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / 2) + 1; page++) {
      const result = await call(
        "member",
        "GET",
        `/projects/${id}/${kind}?page=${page}&pageSize=2`,
      );
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().total).toBe(expected.length);
      seen.push(...result.json().items.map((x: { id: string }) => x.id));
    }
    expect(seen).toEqual(expected.map((x) => x.id));
    expect(new Set(seen).size).toBe(seen.length);
    for (const who of ["owner", "outsider", "foreign"])
      expect(
        (await call(who, "GET", `/projects/${id}/${kind}`)).statusCode,
      ).toBe(404);
  }
  for (const runId of runs) {
    expect(
      (await call("member", "GET", `/runs/${runId}`)).json(),
    ).toMatchObject({
      run: { projectId: null },
      contextProjectId: id,
      automationId: null,
    });
    await expect(
      db.query("UPDATE agent_run SET project_id=$2 WHERE id=$1", [runId, id]),
    ).rejects.toThrow();
  }
  expect(
    (
      await db.query(
        "SELECT project_id FROM agent_run WHERE id=ANY($1::text[])",
        [runs],
      )
    ).every((r) => r.project_id === null),
  ).toBe(true);
  // Even a corrupt extra membership must not expose the default or personal instructions.
  await db.query(
    "ALTER TABLE project_member DISABLE TRIGGER default_project_members",
  );
  try {
    await db.query(
      "INSERT INTO project_member(org_id,project_id,user_id,role) VALUES('a',$1,'outsider','manager')",
      [id],
    );
  } finally {
    await db.query(
      "ALTER TABLE project_member ENABLE TRIGGER default_project_members",
    );
  }
  try {
    expect((await call("outsider", "GET", `/projects/${id}`)).statusCode).toBe(
      404,
    );
    expect((await call("outsider", "GET", `/runs/${runs[0]}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call("outsider", "GET", `/projects/${id}/tasks`)).statusCode,
    ).toBe(404);
  } finally {
    await db.query(
      "ALTER TABLE project_member DISABLE TRIGGER default_project_members",
    );
    try {
      await db.query(
        "DELETE FROM project_member WHERE project_id=$1 AND user_id='outsider'",
        [id],
      );
    } finally {
      await db.query(
        "ALTER TABLE project_member ENABLE TRIGGER default_project_members",
      );
    }
  }
  expect(
    await core.requireProjectAccess(
      { id: "member", orgId: "a" } as import("@workagent/core").AuthUser,
      id,
    ),
  ).toBeTruthy();
});
