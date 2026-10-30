import { z } from "zod";
import { idSchema, timestampSchema, visibilitySchema } from "./common.js";

export const modelConfigSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  model: z.string().min(1).default("gpt-4o-mini"),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().int().min(64).max(32000).default(2048),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const limitsSchema = z.object({
  maxTurns: z.number().int().min(1).max(50).default(12),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30 * 60 * 1000)
    .default(5 * 60 * 1000),
  maxToolCalls: z.number().int().min(1).max(100).default(20),
  maxCostUsd: z.number().min(0).max(100).default(1),
});
export type Limits = z.infer<typeof limitsSchema>;

export const approvalPolicySchema = z.object({
  mode: z.enum(["always", "high_risk", "never"]).default("high_risk"),
  highRiskActions: z
    .array(z.string())
    .default(["write", "delete", "send", "pay"]),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const knowledgeRefSchema = z.object({
  spaceId: idSchema,
  topK: z.number().int().min(1).max(20).default(5),
  minScore: z.number().min(0).max(1).default(0.2),
});
export type KnowledgeRef = z.infer<typeof knowledgeRefSchema>;

export const memoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["session", "user", "org"]).default("user"),
});
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

export const outputConfigSchema = z.object({
  format: z.enum(["text", "markdown", "json"]).default("markdown"),
  schema: z.record(z.string(), z.unknown()).optional(),
});
export type OutputConfig = z.infer<typeof outputConfigSchema>;

export const agentDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
  instructions: z.string().min(1).max(20000),
  model: modelConfigSchema.prefault({}),
  limits: limitsSchema.prefault({}),
  knowledge: z.array(knowledgeRefSchema).default([]),
  tools: z
    .object({
      skillIds: z.array(idSchema).default([]),
      connectorIds: z.array(idSchema).default([]),
    })
    .default({ skillIds: [], connectorIds: [] }),
  approval: approvalPolicySchema.prefault({}),
  memory: memoryConfigSchema.prefault({}),
  output: outputConfigSchema.prefault({}),
  visibility: visibilitySchema.default("org"),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const toolSourceSchema = z.enum(["builtin", "http", "mcp"]);
export type ToolSource = z.infer<typeof toolSourceSchema>;

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const toolPlanItemSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  description: z.string().min(1).max(2000),
  inputSchema: z.record(z.string(), z.unknown()),
  source: toolSourceSchema,
  config: z.record(z.string(), z.unknown()).prefault({}),
  risk: riskLevelSchema.default("low"),
  approvalRequired: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(120000).default(30000),
  maxRetries: z.number().int().min(0).max(3).default(0),
});
export type ToolPlanItem = z.infer<typeof toolPlanItemSchema>;

export const toolPlanSchema = z.object({
  version: z.literal(1),
  agentId: idSchema,
  revisionId: idSchema,
  tools: z.array(toolPlanItemSchema),
  generatedAt: timestampSchema,
});
export type ToolPlan = z.infer<typeof toolPlanSchema>;

export const runtimeBootstrapSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  orgId: idSchema,
  agentId: idSchema,
  revisionId: idSchema,
  version: z.number().int().min(1),
  definition: agentDefinitionSchema,
  toolPlan: toolPlanSchema,
  systemPrompt: z.string(),
  checksum: z.string().min(16),
  createdAt: timestampSchema,
});
export type RuntimeBootstrapSnapshot = z.infer<
  typeof runtimeBootstrapSnapshotSchema
>;

export const agentRevisionSchema = z.object({
  id: idSchema,
  agentId: idSchema,
  version: z.number().int(),
  status: z.enum(["draft", "published", "archived"]),
  definition: agentDefinitionSchema,
  toolPlan: toolPlanSchema.nullable(),
  bootstrap: runtimeBootstrapSnapshotSchema.nullable(),
  changelog: z.string().default(""),
  createdBy: idSchema,
  createdAt: timestampSchema,
  publishedAt: timestampSchema.nullable(),
});
export type AgentRevision = z.infer<typeof agentRevisionSchema>;

export const agentSummarySchema = z.object({
  personal: z.boolean().optional(),
  id: idSchema,
  name: z.string(),
  description: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  currentRevisionId: idSchema.nullable(),
  publishedVersion: z.number().int().nullable(),
  visibility: visibilitySchema,
  updatedAt: timestampSchema,
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const createAgentSchema = z.object({
  definition: agentDefinitionSchema,
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z.object({
  definition: agentDefinitionSchema,
  changelog: z.string().max(500).default(""),
});
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const publishAgentSchema = z.object({
  overrideReason: z.string().trim().min(20).max(1000).optional(),
  changelog: z.string().max(500).default(""),
});
export type PublishAgentInput = z.infer<typeof publishAgentSchema>;

export const agentPreviewSchema = z.object({
  message: z.string().min(1).max(8000),
  variables: z.record(z.string(), z.string()).prefault({}),
});
export type AgentPreviewInput = z.infer<typeof agentPreviewSchema>;
