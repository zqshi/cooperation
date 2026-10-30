import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
if (!process.env.TEST_DATABASE_URL)
  throw new Error("Isolated TEST_DATABASE_URL required");
process.env.ENV_FILE = "/tmp/workagent-browser-no-env";
process.env.NODE_ENV = "test";
const artifactDir = await fs.mkdtemp(
  new URL("../.browser-artifacts-", import.meta.url),
);
process.env.ARTIFACT_DIR = artifactDir;
process.env.USE_MOCK_MODEL = "true";
process.env.CONSOLE_ORIGIN = "http://127.0.0.1:16173";
process.env.USER_PORTAL_ORIGIN = "http://127.0.0.1:16174";
const schema = `wa_browser_${randomUUID().replaceAll("-", "")}`;
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set("options", `-c search_path=${schema},public`);
process.env.DATABASE_URL = url.toString();
const { pool, query, closePool } = await import("../packages/db/src/client.js");
const setup = await pool.connect();
try {
  await setup.query("BEGIN");
  await setup.query("SELECT pg_advisory_xact_lock(78009412)");
  await setup.query(
    "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public",
  );
  await setup.query("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public");
  await setup.query(`DO $$ BEGIN
 IF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='vector') <> 'public' THEN ALTER EXTENSION vector SET SCHEMA public; END IF;
 IF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='pgcrypto') <> 'public' THEN ALTER EXTENSION pgcrypto SET SCHEMA public; END IF;
END $$`);
  await setup.query("COMMIT");
} finally {
  setup.release();
}
await query(`CREATE SCHEMA ${schema}`);
for (const file of (
  await fs.readdir(new URL("../packages/db/migrations/", import.meta.url))
)
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await query(
    await fs.readFile(
      new URL(`../packages/db/migrations/${file}`, import.meta.url),
      "utf8",
    ),
  );
const { hashPassword, sha256: coreSessionHash } =
  await import("../packages/core/src/crypto.js");
await query(
  "INSERT INTO org(id,name,slug) VALUES('browser','Browser test','browser')",
);
for (const [id, role] of [
  ["reviewer", "owner"],
  ["executor", "user"],
  ["onboarding", "user"],
  ["uncreated", "user"],
]) {
  await query(
    "INSERT INTO app_user(id,email,name,password_hash) VALUES($1,$2,$1,$3)",
    [id, `${id}@browser.test`, await hashPassword("Browser-test-2026!")],
  );
  await query(
    "INSERT INTO membership(org_id,user_id,role,status) VALUES('browser',$1,$2,'active')",
    [id, role],
  );
}
const { savePersonalAssistant } =
  await import("../packages/core/src/personal.js");
for (const id of ["reviewer", "executor"]) {
  await savePersonalAssistant(
    {
      id,
      orgId: "browser",
      role: id === "reviewer" ? "owner" : "user",
    } as Parameters<typeof savePersonalAssistant>[0],
    {
      name: `${id} personal fixture`,
      avatar: "spark",
      purpose: "Isolated entered-Portal fixture",
      preferences: "",
    },
    true,
  );
}
// Persisted synthetic sessions keep navigation regressions independent of the login
// endpoint's real per-IP throttle. Login/security/onboarding suites still use real login.
for (const id of ["reviewer", "executor"]) {
  await query(
    "INSERT INTO session(user_id,org_id,token_hash,expires_at) VALUES($1,'browser',$2,now()+interval '1 hour')",
    [id, coreSessionHash(`isolated-project-${id}-cookie`)],
  );
}
await query("INSERT INTO platform_admin(user_id) VALUES('reviewer')");
await query(
  `INSERT INTO quota(org_id,scope,scope_id,monthly_budget_usd,current_cost_usd) VALUES('browser','org','browser',100,1.25)`,
);
// Display fixtures only; no worker, outbound job or vendor call is started.
await query(
  `INSERT INTO agent(id,org_id,name,description,status,created_by) VALUES('ux-agent','browser','审批演示 Agent','仅用于隔离浏览器验收','published','reviewer')`,
);
await query(
  `INSERT INTO agent_revision(id,agent_id,version,status,definition,created_by) VALUES('ux-revision','ux-agent',1,'published','{"name":"审批演示 Agent","instructions":"Browser fixture"}','reviewer')`,
);
const { compileAgent } = await import("../packages/core/src/compiler.js");
const { agentDefinitionSchema } =
  await import("../packages/contracts/src/agent.js");
const compiled = await compileAgent({
  orgId: "browser",
  agentId: "ux-agent",
  revisionId: "ux-revision",
  version: 1,
  definition: agentDefinitionSchema.parse({
    name: "审批演示 Agent",
    instructions: "Browser fixture",
  }),
});
await query(
  "UPDATE agent_revision SET definition=$1,tool_plan=$2,bootstrap=$3 WHERE id='ux-revision'",
  [
    JSON.stringify(compiled.definition),
    JSON.stringify(compiled.toolPlan),
    JSON.stringify(compiled.bootstrap),
  ],
);
await query(
  `UPDATE agent SET current_revision_id='ux-revision',published_version=1 WHERE id='ux-agent'`,
);
await query(
  `INSERT INTO conversation(id,org_id,agent_id,user_id,title) VALUES('ux-conversation','browser','ux-agent','reviewer','审批上下文')`,
);
await query(
  `INSERT INTO agent_run(id,org_id,agent_id,revision_id,conversation_id,user_id,status,input) VALUES('ux-run','browser','ux-agent','ux-revision','ux-conversation','reviewer','waiting_approval','请审核这份项目交付说明')`,
);
await query(
  `INSERT INTO approval(run_id,tool_name,reason,input,requested_by) VALUES('ux-run','document.publish','对外发布前需要人工审批','{"document":"项目交付说明"}','reviewer')`,
);
// Synthetic display fixtures live only in this random schema and disposable storage.
for (const [id, status, input, output, error, who] of [
  [
    "ux-completed",
    "succeeded",
    "整理周会行动清单",
    "决定：周五复核。待办：李明整理素材。",
    null,
    "reviewer",
  ],
  [
    "ux-failed",
    "failed",
    "汇总本周资料",
    null,
    "模型服务未配置，请联系企业管理员。",
    "reviewer",
  ],
  [
    "ux-delivery",
    "succeeded",
    "准备交付检查清单",
    "交付检查清单已整理，请下载核对并独立验收。",
    null,
    "executor",
  ],
]) {
  await query(
    "INSERT INTO conversation(id,org_id,agent_id,user_id,title) VALUES($1,'browser','ux-agent',$2,$3)",
    [`${id}-conversation`, who, input],
  );
  await query(
    "INSERT INTO agent_run(id,org_id,agent_id,revision_id,conversation_id,user_id,status,input,output,error,started_at,finished_at) VALUES($1,'browser','ux-agent','ux-revision',$2,$3,$4,$5,$6,$7,now(),now())",
    [id, `${id}-conversation`, who, status, input, output, error],
  );
  await query(
    "INSERT INTO message(conversation_id,run_id,role,content) VALUES($1,$2,'user',$3)",
    [`${id}-conversation`, id, input],
  );
  if (output)
    await query(
      "INSERT INTO message(conversation_id,run_id,role,content) VALUES($1,$2,'assistant',$3)",
      [`${id}-conversation`, id, output],
    );
  await query(
    "INSERT INTO run_step(run_id,seq,kind,name,status,output,error) VALUES($1,1,'system','整理交付结果',$2,$3,$4)",
    [id, status, JSON.stringify(output), error],
  );
}
await query(
  "INSERT INTO message(conversation_id,run_id,role,content) VALUES('ux-conversation','ux-run','user','请审核这份项目交付说明')",
);
await query(
  "INSERT INTO run_step(run_id,seq,kind,name,status,input) VALUES('ux-run',1,'approval','发布前人工审批','started','{}')",
);
const { putObject } = await import("../packages/core/src/storage.js");
const file = await putObject(
  "browser/ux-delivery/checklist.txt",
  Buffer.from(
    "Synthetic isolated fixture: verify deliverables and independent acceptance.",
  ),
  "text/plain",
);
await query(
  "INSERT INTO artifact(run_id,name,mime_type,size,storage_key) VALUES('ux-delivery','交付检查清单.txt','text/plain',$1,$2)",
  [file.size, file.key],
);
await query(
  "INSERT INTO usage_record(org_id,run_id,agent_id,user_id,kind,input_tokens,output_tokens,quantity,cost_usd) VALUES('browser','ux-delivery','ux-agent','onboarding','model',240,80,1,0.000168)",
);
// A real persisted binding projection in this disposable schema, with no vendor credentials.
await query(
  "INSERT INTO channel_account(id,org_id,type,name,status) VALUES('portal-channel','browser','feishu','测试团队渠道','disabled')",
);
await query(
  "INSERT INTO channel_binding(org_id,account_id,user_id,external_user_id) VALUES('browser','portal-channel','onboarding','isolated-onboarding-fixture')",
);
// Project display fixtures are actual durable tasks and transactionally associated attempts.
const core = await import("../packages/core/src/index.js");
const actor = {
  id: "reviewer",
  orgId: "browser",
  role: "owner",
  name: "reviewer",
  email: "reviewer@browser.test",
} as Parameters<typeof core.createProject>[0];
const fixtureProject = await core.createProject(actor, {
  name: "项目交付回归",
  description: "本项目用于验证任务、执行审批与真实产物的来源关联。",
});
for (const [title, status] of [
  ["交付材料整理", "succeeded"],
  ["发布材料审核", "waiting_approval"],
] as const) {
  const task = await core.createProjectTask(actor, fixtureProject.id, {
    title,
    description: "检查材料并保留独立验收。",
    assigneeId: "reviewer",
    agentId: "ux-agent",
  });
  const { run } = await core.startTaskAttempt(
    actor,
    fixtureProject.id,
    task.id,
    `browser-${status}`,
  );
  await query("UPDATE agent_run SET status=$2,output=$3 WHERE id=$1", [
    run.id,
    status,
    status === "succeeded" ? "项目真实文本输出：交付清单已整理。" : null,
  ]);
  if (status === "succeeded") {
    const object = await putObject(
      `browser/project/${run.id}/delivery.txt`,
      Buffer.from("Project-scoped synthetic delivery"),
      "text/plain",
    );
    await query(
      "INSERT INTO artifact(run_id,name,mime_type,size,storage_key) VALUES($1,'项目交付清单.txt','text/plain',$2,$3)",
      [run.id, object.size, object.key],
    );
  } else {
    await query(
      "INSERT INTO approval(run_id,tool_name,reason,input,requested_by) VALUES($1,'document.publish','项目发布前需要审批','{}','reviewer')",
      [run.id],
    );
  }
}
const otherProject = await core.createProject(actor, {
  name: "隔离项目",
  description: "不应出现其他项目的数据。",
});
const { buildServer } = await import("../apps/api/src/server.js");
const app = await buildServer({ testRateLimitMax: 10000 });
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await fs.rm(artifactDir, { recursive: true, force: true });
  await query(`DROP SCHEMA ${schema} CASCADE`);
  await closePool();
}
// Isolated browser-only execution drain; production APIs never expose this.
app.post<{ Body: { id: string } }>("/mock/automation-drain", async (req) => {
  const rows = await query<{ id: string; org_id: string }>(
    "SELECT r.id,r.org_id FROM agent_run r JOIN automation_occurrence o ON o.run_id=r.id AND o.org_id=r.org_id JOIN personal_automation a ON a.id=o.automation_id WHERE a.id=$1 AND a.org_id='browser' AND a.owner_id='executor' AND r.status='queued'",
    [req.body.id],
  );
  for (const r of rows) await core.executeRun(r.id, r.org_id);
  return { ok: true };
});
// This endpoint exists only in this isolated test harness, never in the product server.
app.post("/mock/browser-cleanup", async () => {
  await cleanup();
  return { ok: true };
});
await app.listen({ host: "127.0.0.1", port: 16100 });
const children = ["console", "user-portal"].map((name, i) =>
  spawn(
    "pnpm",
    [
      "--filter",
      `@workagent/${name}`,
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(16173 + i),
      "--strictPort",
    ],
    {
      env: { ...process.env, WA_TEST_API_URL: "http://127.0.0.1:16100" },
      stdio: "inherit",
    },
  ),
);
async function stop() {
  for (const c of children) c.kill("SIGTERM");
  await cleanup();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
