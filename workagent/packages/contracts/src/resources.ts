import { z } from "zod";
import { idSchema, timestampSchema, visibilitySchema } from "./common.js";

export const skillSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  version: z.number().int(),
  status: z.enum(["draft", "active", "archived"]),
  visibility: visibilitySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Skill = z.infer<typeof skillSchema>;

export const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
  instructions: z.string().min(1).max(20000),
  visibility: visibilitySchema.default("org"),
});
export type CreateSkillInput = z.infer<typeof createSkillSchema>;

export const updateSkillSchema = createSkillSchema.partial();
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;

export const connectorToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  description: z.string().min(1).max(2000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  path: z.string().min(1).max(500),
  inputSchema: z
    .record(z.string(), z.unknown())
    .default({ type: "object", properties: {} }),
  risk: z.enum(["low", "medium", "high"]).default("low"),
  approvalRequired: z.boolean().default(false),
});
export type ConnectorTool = z.infer<typeof connectorToolSchema>;

export const connectorSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  type: z.enum(["http", "mcp"]),
  baseUrl: z.string().nullable(),
  mcpUrl: z.string().nullable(),
  authType: z.enum(["none", "bearer", "api_key", "basic"]),
  status: z.enum(["draft", "active", "disabled"]),
  tools: z.array(connectorToolSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Connector = z.infer<typeof connectorSchema>;

export const createConnectorSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
  type: z.enum(["http", "mcp"]).default("http"),
  baseUrl: z.string().url().optional(),
  mcpUrl: z.string().url().optional(),
  authType: z.enum(["none", "bearer", "api_key", "basic"]).default("none"),
  secret: z.string().max(4000).optional(),
  tools: z.array(connectorToolSchema).default([]),
});
export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;

export const updateConnectorSchema = createConnectorSchema.partial();
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;

export const knowledgeSpaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  embeddingModel: z.string(),
  documentCount: z.number().int().default(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type KnowledgeSpace = z.infer<typeof knowledgeSpaceSchema>;

export const createKnowledgeSpaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
  embeddingModel: z.string().max(100).default("text-embedding-3-small"),
});
export type CreateKnowledgeSpaceInput = z.infer<
  typeof createKnowledgeSpaceSchema
>;

export const documentSchema = z.object({
  id: idSchema,
  spaceId: idSchema,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  error: z.string().nullable(),
  chunkCount: z.number().int().default(0),
  createdAt: timestampSchema,
});
export type Document = z.infer<typeof documentSchema>;

export const retrievedChunkSchema = z.object({
  chunkId: idSchema,
  documentId: idSchema,
  documentName: z.string(),
  content: z.string(),
  score: z.number(),
});
export type RetrievedChunk = z.infer<typeof retrievedChunkSchema>;

export const searchKnowledgeSchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).default(5),
  minScore: z.number().min(0).max(1).default(0.2),
});
export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeSchema>;
