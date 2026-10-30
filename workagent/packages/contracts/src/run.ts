import { z } from "zod";
import { idSchema, timestampSchema } from "./common.js";

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "canceled",
  "timeout",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runStepKindSchema = z.enum([
  "model",
  "tool",
  "knowledge",
  "approval",
  "artifact",
  "system",
]);
export type RunStepKind = z.infer<typeof runStepKindSchema>;

export const runStepStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "skipped",
]);
export type RunStepStatus = z.infer<typeof runStepStatusSchema>;

export const messageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const conversationSchema = z.object({
  id: idSchema,
  agentId: idSchema,
  userId: idSchema,
  title: z.string(),
  channel: z.string().default("web"),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  role: messageRoleSchema,
  content: z.string(),
  toolName: z.string().nullable(),
  toolCallId: z.string().nullable(),
  createdAt: timestampSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const runSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  projectId: idSchema.nullable().optional(),
  agentId: idSchema,
  revisionId: idSchema,
  conversationId: idSchema,
  userId: idSchema,
  status: runStatusSchema,
  input: z.string(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  channel: z.string().default("web"),
  turns: z.number().int().default(0),
  toolCalls: z.number().int().default(0),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  costUsd: z.number().default(0),
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Run = z.infer<typeof runSchema>;

export const runStepSchema = z.object({
  id: idSchema,
  runId: idSchema,
  seq: z.number().int(),
  kind: runStepKindSchema,
  name: z.string(),
  status: runStepStatusSchema,
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: timestampSchema,
});
export type RunStep = z.infer<typeof runStepSchema>;

export const artifactSchema = z.object({
  id: idSchema,
  runId: idSchema,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  url: z.string(),
  createdAt: timestampSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalSchema = z.object({
  id: idSchema,
  runId: idSchema,
  toolName: z.string(),
  reason: z.string(),
  input: z.unknown(),
  status: approvalStatusSchema,
  requestedBy: idSchema,
  decidedBy: idSchema.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: timestampSchema,
  decidedAt: timestampSchema.nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const createRunSchema = z.object({
  agentId: idSchema,
  message: z.string().min(1).max(20000),
  conversationId: idSchema.optional(),
  channel: z.string().max(32).default("web"),
  idempotencyKey: z.string().max(128).optional(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const runDetailSchema = z.object({
  contextProjectId: idSchema.nullable().optional(),
  automationId: idSchema.nullable().optional(),
  task: z.object({ id: idSchema, title: z.string() }).nullable().optional(),
  run: runSchema,
  conversation: conversationSchema,
  messages: z.array(messageSchema),
  steps: z.array(runStepSchema),
  artifacts: z.array(artifactSchema),
  approval: approvalSchema.nullable(),
  capabilities: z
    .object({ canWrite: z.boolean(), canAccept: z.boolean() })
    .optional(),
  acceptance: z
    .object({
      decision: z.enum(["accepted", "rejected"]),
      note: z.string(),
      createdAt: timestampSchema,
    })
    .nullable()
    .optional(),
});
export type RunDetail = z.infer<typeof runDetailSchema>;

export const decideApprovalSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(1000).default(""),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

export const runEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.status"),
    runId: idSchema,
    status: runStatusSchema,
    at: timestampSchema,
  }),
  z.object({
    type: z.literal("message.delta"),
    runId: idSchema,
    messageId: idSchema,
    delta: z.string(),
  }),
  z.object({
    type: z.literal("message.completed"),
    runId: idSchema,
    messageId: idSchema,
    content: z.string(),
  }),
  z.object({
    type: z.literal("step.started"),
    runId: idSchema,
    step: runStepSchema,
  }),
  z.object({
    type: z.literal("step.completed"),
    runId: idSchema,
    step: runStepSchema,
  }),
  z.object({
    type: z.literal("artifact.created"),
    runId: idSchema,
    artifact: artifactSchema,
  }),
  z.object({
    type: z.literal("approval.required"),
    runId: idSchema,
    approval: approvalSchema,
  }),
  z.object({
    type: z.literal("run.completed"),
    runId: idSchema,
    status: runStatusSchema,
    output: z.string().nullable(),
  }),
  z.object({
    type: z.literal("run.failed"),
    runId: idSchema,
    error: z.string(),
  }),
  z.object({ type: z.literal("heartbeat"), at: timestampSchema }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;
