import { compileSchema } from "./json-schema.js";
import {
  agentDefinitionSchema,
  type AgentDefinition,
  type ConnectorTool,
  type RuntimeBootstrapSnapshot,
  type ToolPlan,
  type ToolPlanItem,
} from "@workagent/contracts";
import { query } from "@workagent/db";
import { stableChecksum } from "./crypto.js";
import { notFound } from "./errors.js";

type SkillRow = {
  id: string;
  name: string;
  instructions: string;
  status: string;
};

type ConnectorRow = {
  id: string;
  name: string;
  type: "http" | "mcp";
  base_url: string | null;
  mcp_url: string | null;
  auth_type: string;
  status: string;
  tools: ConnectorTool[];
};

export type CompileInput = {
  orgId: string;
  agentId: string;
  revisionId: string;
  version: number;
  definition: AgentDefinition;
  createdAt?: string;
};

export type CompileResult = {
  definition: AgentDefinition;
  toolPlan: ToolPlan;
  bootstrap: RuntimeBootstrapSnapshot;
};

export async function loadAgentResources(
  orgId: string,
  definition: AgentDefinition,
): Promise<{ skills: SkillRow[]; connectors: ConnectorRow[] }> {
  const skillIds = definition.tools.skillIds;
  const connectorIds = definition.tools.connectorIds;

  const skills =
    skillIds.length === 0
      ? []
      : await query<SkillRow>(
          `SELECT id, name, instructions, status
             FROM skill
            WHERE org_id = $1 AND id = ANY($2::text[]) AND status = 'active'`,
          [orgId, skillIds],
        );

  const connectors =
    connectorIds.length === 0
      ? []
      : await query<ConnectorRow>(
          `SELECT id, name, type, base_url, mcp_url, auth_type, status, tools
             FROM connector
            WHERE org_id = $1 AND id = ANY($2::text[]) AND status = 'active'`,
          [orgId, connectorIds],
        );

  if (skills.length !== skillIds.length) {
    const found = new Set(skills.map((skill) => skill.id));
    const missing = skillIds.filter((id) => !found.has(id));
    throw notFound(`Skill 不存在或未启用: ${missing.join(", ")}`);
  }
  if (connectors.length !== connectorIds.length) {
    const found = new Set(connectors.map((connector) => connector.id));
    const missing = connectorIds.filter((id) => !found.has(id));
    throw notFound(`Connector 不存在或未启用: ${missing.join(", ")}`);
  }

  const spaces = definition.knowledge.map((ref) => ref.spaceId);
  if (spaces.length) {
    const found = await query(
      "SELECT id FROM knowledge_space WHERE org_id=$1 AND id=ANY($2::text[])",
      [orgId, spaces],
    );
    if (found.length !== new Set(spaces).size)
      throw notFound("Knowledge space unavailable");
  }
  return { skills, connectors };
}

export async function compileAgent(
  input: CompileInput,
): Promise<CompileResult> {
  const definition = agentDefinitionSchema.parse(input.definition);
  const { skills, connectors } = await loadAgentResources(
    input.orgId,
    definition,
  );
  const createdAt = input.createdAt ?? new Date().toISOString();

  const tools: ToolPlanItem[] = [];
  const usedNames = new Set<string>();

  for (const connector of connectors) {
    for (const tool of connector.tools ?? []) {
      const baseName = tool.name;
      let name = baseName;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${baseName}_${suffix}`;
        suffix += 1;
      }
      usedNames.add(name);

      const isMcp = connector.type === "mcp";
      tools.push({
        name,
        description: `${connector.name}：${tool.description}`,
        inputSchema: tool.inputSchema,
        source: isMcp ? "mcp" : "http",
        config: isMcp
          ? {
              connectorId: connector.id,
              mcpUrl: connector.mcp_url,
              toolName: tool.name,
            }
          : {
              connectorId: connector.id,
              baseUrl: connector.base_url,
              method: tool.method,
              path: tool.path,
              authType: connector.auth_type,
            },
        risk: tool.risk,
        approvalRequired: tool.approvalRequired,
        timeoutMs: 30_000,
        maxRetries: 0,
      });
    }
  }

  const toolPlan: ToolPlan = {
    version: 1,
    agentId: input.agentId,
    revisionId: input.revisionId,
    tools,
    generatedAt: createdAt,
  };

  for (const tool of tools) compileSchema(tool.inputSchema);
  const systemPrompt = buildSystemPrompt(definition, skills, toolPlan);
  const checksum = stableChecksum({
    definition,
    tools: toolPlan.tools,
    systemPrompt,
  });

  const bootstrap: RuntimeBootstrapSnapshot = {
    schemaVersion: 1,
    orgId: input.orgId,
    agentId: input.agentId,
    revisionId: input.revisionId,
    version: input.version,
    definition,
    toolPlan,
    systemPrompt,
    checksum,
    createdAt,
  };

  return { definition, toolPlan, bootstrap };
}

export function buildSystemPrompt(
  definition: AgentDefinition,
  skills: Array<{ name: string; instructions: string }>,
  toolPlan: ToolPlan,
): string {
  const parts: string[] = [
    `你是 ${definition.name}。`,
    definition.description ? `\n${definition.description}` : "",
    `\n${definition.instructions}`,
  ];

  if (skills.length > 0) {
    parts.push("\n【技能】");
    for (const skill of skills) {
      parts.push(`## ${skill.name}\n${skill.instructions}`);
    }
  }

  if (toolPlan.tools.length > 0) {
    parts.push("\n【可用工具】");
    for (const tool of toolPlan.tools) {
      parts.push(`- ${tool.name}: ${tool.description}`);
    }
  }

  parts.push(
    [
      "\n【工作方式】",
      "1. 先判断问题是否需要知识库依据或工具数据。",
      "2. 需要事实时先检索或调用工具，不要凭空回答。",
      "3. 工具失败时说明失败原因，并给出下一步建议。",
      "4. 涉及写操作、发送、支付、删除等高风险动作时，请求人工确认。",
      "5. 不知道就明确说不知道，不要编造。",
      "6. 回答简洁、具体、可执行。",
    ].join("\n"),
  );

  parts.push(
    `\n【输出格式】\n${
      definition.output.format === "json"
        ? "输出必须是合法 JSON，不要包含 Markdown 代码块。"
        : definition.output.format === "text"
          ? "输出纯文本，不要使用复杂格式。"
          : "使用 Markdown，保持结构清晰。"
    }`,
  );

  return parts.filter(Boolean).join("\n");
}
