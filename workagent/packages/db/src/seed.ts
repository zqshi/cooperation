import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "@workagent/config";

if (config.isProd) throw new Error("Seed is forbidden in production");
import { closePool, one, query, tx } from "./client.js";

function checksum(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function main(): Promise<void> {
  const orgSlug = "workagent-demo";
  const now = new Date().toISOString();

  let org = await one<{ id: string }>("SELECT id FROM org WHERE slug = $1", [
    orgSlug,
  ]);
  if (!org) {
    org = await one<{ id: string }>(
      "INSERT INTO org (name, slug, plan) VALUES ($1, $2, 'team') RETURNING id",
      [config.seedOrgName, orgSlug],
    );
  }
  if (!org) throw new Error("failed to create org");

  const passwordHash = await bcrypt.hash(config.seedAdminPassword, 10);
  let user = await one<{ id: string }>(
    "SELECT id FROM app_user WHERE email = $1",
    [config.seedAdminEmail],
  );
  if (!user) {
    user = await one<{ id: string }>(
      "INSERT INTO app_user (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [config.seedAdminEmail, "Admin", passwordHash],
    );
  } else {
    await query("UPDATE app_user SET password_hash = $1 WHERE id = $2", [
      passwordHash,
      user.id,
    ]);
  }
  if (!user) throw new Error("failed to create admin user");

  await query(
    `INSERT INTO membership (org_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active'`,
    [org.id, user.id],
  );

  const skill = await ensureSkill(org.id);
  const space = await ensureKnowledgeSpace(org.id);
  const connector = await ensureConnector(org.id);

  const agent = await ensureAgent({
    orgId: org.id,
    userId: user.id,
    skillId: skill.id,
    skillInstructions: skill.instructions,
    connectorId: connector.id,
  });

  await ensureEvalDataset(org.id, agent.id);
  await ensureMockChannel(org.id, agent.id);
  await ensureQuota(org.id);

  console.log("seed complete");
  console.log(`org:      ${org.id}`);
  console.log(
    `admin:    ${config.seedAdminEmail} / ${config.seedAdminPassword}`,
  );
  console.log(`agent:    ${agent.id} (${agent.name})`);
  console.log(`space:    ${space.id}`);
  console.log(`connector:${connector.id}`);

  await closePool();
}

async function ensureSkill(
  orgId: string,
): Promise<{ id: string; instructions: string }> {
  const name = "客服回复规范";
  const instructions = [
    "回复客户时先确认问题与订单信息。",
    "涉及金额、退款、赔付时，必须给出依据并标记为需要人工确认。",
    "不知道答案时明确说明，不要编造。",
  ].join("\n");

  const existing = await one<{ id: string; instructions: string }>(
    "SELECT id, instructions FROM skill WHERE org_id = $1 AND name = $2",
    [orgId, name],
  );
  if (existing) return existing;

  const created = await one<{ id: string }>(
    `INSERT INTO skill (org_id, name, description, instructions, version, status, visibility)
     VALUES ($1, $2, $3, $4, 1, 'active', 'org') RETURNING id`,
    [orgId, name, "客服场景的通用回复与升级规则", instructions],
  );
  if (!created) throw new Error("failed to create skill");
  return { id: created.id, instructions };
}

async function ensureKnowledgeSpace(orgId: string): Promise<{ id: string }> {
  const name = "产品与售后知识库";
  const existing = await one<{ id: string }>(
    "SELECT id FROM knowledge_space WHERE org_id = $1 AND name = $2",
    [orgId, name],
  );
  if (existing) return existing;
  const created = await one<{ id: string }>(
    `INSERT INTO knowledge_space (org_id, name, description, embedding_model)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, name, "演示知识库，可在管理端上传文档", config.embeddingModel],
  );
  if (!created) throw new Error("failed to create knowledge space");
  return created;
}

async function ensureConnector(orgId: string): Promise<{ id: string }> {
  const name = "订单查询（演示）";
  const existing = await one<{ id: string }>(
    "SELECT id FROM connector WHERE org_id = $1 AND name = $2",
    [orgId, name],
  );
  if (existing) return existing;

  const tools = [
    {
      name: "lookup_order",
      description: "根据订单号查询订单状态、金额和物流信息",
      method: "POST",
      path: "/mock/tools/lookup_order",
      inputSchema: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "订单号" },
        },
        required: ["orderId"],
      },
      risk: "low",
      approvalRequired: false,
    },
  ];

  const created = await one<{ id: string }>(
    `INSERT INTO connector (org_id, name, description, type, base_url, auth_type, status, tools)
     VALUES ($1, $2, $3, 'http', $4, 'none', 'active', $5::jsonb) RETURNING id`,
    [
      orgId,
      name,
      "演示用订单查询连接器，由 API 的 /mock/tools 提供",
      config.apiUrl,
      JSON.stringify(tools),
    ],
  );
  if (!created) throw new Error("failed to create connector");
  return created;
}

async function ensureAgent(input: {
  orgId: string;
  userId: string;
  skillId: string;
  skillInstructions: string;
  connectorId: string;
}): Promise<{ id: string; name: string }> {
  const name = "售后客服助手";
  const existing = await one<{ id: string; name: string }>(
    "SELECT id, name FROM agent WHERE org_id = $1 AND name = $2",
    [input.orgId, name],
  );
  if (existing) return existing;

  const agentId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const definition = {
    name,
    description:
      "处理售后咨询：查订单、解释政策、生成回复草稿，高风险动作转人工。",
    instructions: [
      "你是售后客服助手。",
      "先理解客户问题，必要时调用订单查询工具获取事实。",
      "回答必须基于工具结果或知识库依据；没有依据时明确说明。",
      "涉及退款、赔付、金额调整时，给出建议并标记需要人工确认。",
      "输出简洁、可执行，使用中文。",
    ].join("\n"),
    model: {
      provider: "openai-compatible",
      model: config.modelName,
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
    limits: { maxTurns: 8, timeoutMs: 300000, maxToolCalls: 10, maxCostUsd: 1 },
    knowledge: [{ spaceId: "", topK: 5, minScore: 0.2 }],
    tools: { skillIds: [input.skillId], connectorIds: [input.connectorId] },
    approval: {
      mode: "high_risk",
      highRiskActions: ["write", "delete", "send", "pay"],
    },
    memory: { enabled: false, mode: "user" },
    output: { format: "markdown" },
    visibility: "org",
  };

  const space = await one<{ id: string }>(
    "SELECT id FROM knowledge_space WHERE org_id = $1 ORDER BY created_at LIMIT 1",
    [input.orgId],
  );
  if (space) definition.knowledge[0]!.spaceId = space.id;

  const toolPlan = {
    version: 1,
    agentId,
    revisionId,
    tools: [
      {
        name: "lookup_order",
        description: "根据订单号查询订单状态、金额和物流信息",
        inputSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "订单号" },
          },
          required: ["orderId"],
        },
        source: "http",
        config: {
          baseUrl: config.apiUrl,
          method: "POST",
          path: "/mock/tools/lookup_order",
          authType: "none",
        },
        risk: "low",
        approvalRequired: false,
        timeoutMs: 30000,
        maxRetries: 0,
      },
    ],
    generatedAt: createdAt,
  };

  const systemPrompt = [
    definition.instructions,
    "",
    "【技能】",
    input.skillInstructions,
    "",
    "【工具】",
    "lookup_order: 根据订单号查询订单状态、金额和物流信息。",
    "",
    "【规则】",
    "先查事实再回答。没有依据时说明不知道。高风险动作必须请求人工确认。",
  ].join("\n");

  const bootstrap = {
    schemaVersion: 1,
    orgId: input.orgId,
    agentId,
    revisionId,
    version: 1,
    definition,
    toolPlan,
    systemPrompt,
    checksum: checksum({ definition, toolPlan, systemPrompt }),
    createdAt,
  };

  await tx(async (client) => {
    await client.query(
      `INSERT INTO agent (id, org_id, name, description, status, published_version, visibility, created_by)
       VALUES ($1, $2, $3, $4, 'published', 1, 'org', $5)`,
      [agentId, input.orgId, name, definition.description, input.userId],
    );

    await client.query(
      `INSERT INTO agent_revision
       (id, agent_id, version, status, definition, tool_plan, bootstrap, changelog, created_by, published_at)
     VALUES ($1, $2, 1, 'published', $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, now())`,
      [
        revisionId,
        agentId,
        JSON.stringify(definition),
        JSON.stringify(toolPlan),
        JSON.stringify(bootstrap),
        "初始版本",
        input.userId,
      ],
    );

    await client.query(
      "UPDATE agent SET current_revision_id = $1 WHERE id = $2 AND org_id = $3",
      [revisionId, agentId, input.orgId],
    );
  });

  return { id: agentId, name };
}

async function ensureEvalDataset(
  orgId: string,
  agentId: string,
): Promise<void> {
  const name = "售后客服回归集";
  const existing = await one<{ id: string }>(
    "SELECT id FROM eval_dataset WHERE org_id = $1 AND agent_id = $2 AND name = $3",
    [orgId, agentId, name],
  );
  if (existing) return;

  const dataset = await one<{ id: string }>(
    `INSERT INTO eval_dataset (org_id, agent_id, name, description)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, agentId, name, "演示用评测集，发布前必须通过"],
  );
  if (!dataset) return;

  const cases = [
    {
      name: "查询订单",
      input: "帮我查一下订单 A20260101 的状态",
      expected: "已发货",
      assertions: [{ type: "contains", value: "A20260101" }],
    },
    {
      name: "无依据不编造",
      input: "你们支持无条件终身退款吗？",
      expected: "需要人工确认",
      assertions: [{ type: "not_contains", value: "无条件终身退款" }],
    },
  ];

  for (const item of cases) {
    await query(
      `INSERT INTO eval_case (dataset_id, name, input, expected, assertions)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        dataset.id,
        item.name,
        item.input,
        item.expected,
        JSON.stringify(item.assertions),
      ],
    );
  }
}

async function ensureMockChannel(
  orgId: string,
  agentId: string,
): Promise<void> {
  const existing = await one<{ id: string }>(
    "SELECT id FROM channel_account WHERE org_id = $1 AND type = 'mock'",
    [orgId],
  );
  if (existing) {
    await query(
      "UPDATE channel_account SET default_agent_id = $2 WHERE id = $1",
      [existing.id, agentId],
    );
    return;
  }
  await query(
    `INSERT INTO channel_account (org_id, type, name, status, app_id, default_agent_id)
     VALUES ($1, 'mock', '本地模拟渠道', 'active', 'mock', $2)`,
    [orgId, agentId],
  );
}

async function ensureQuota(orgId: string): Promise<void> {
  await query(
    `INSERT INTO quota (org_id, scope, scope_id, monthly_budget_usd, monthly_run_limit)
     VALUES ($1, 'org', $1, 100, 10000)
     ON CONFLICT (org_id, scope, scope_id) DO NOTHING`,
    [orgId],
  );
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
