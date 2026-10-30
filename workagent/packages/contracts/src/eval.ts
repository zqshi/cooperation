import { z } from "zod";
import { idSchema, timestampSchema } from "./common.js";

export const evalCaseSchema = z.object({
  id: idSchema,
  datasetId: idSchema,
  name: z.string(),
  input: z.string(),
  expected: z.string().nullable(),
  assertions: z.array(
    z.object({
      type: z.enum([
        "contains",
        "not_contains",
        "regex",
        "json_schema",
        "tool_called",
      ]),
      value: z.string().max(65536),
    }),
  ),
  createdAt: timestampSchema,
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalDatasetSchema = z.object({
  id: idSchema,
  agentId: idSchema,
  name: z.string(),
  description: z.string(),
  caseCount: z.number().int().default(0),
  createdAt: timestampSchema,
});
export type EvalDataset = z.infer<typeof evalDatasetSchema>;

export const createEvalDatasetSchema = z.object({
  agentId: idSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
});
export type CreateEvalDatasetInput = z.infer<typeof createEvalDatasetSchema>;

export const createEvalCaseSchema = z.object({
  name: z.string().min(1).max(100),
  input: z.string().min(1).max(20000),
  expected: z.string().max(20000).optional(),
  assertions: z
    .array(
      z.object({
        type: z.enum([
          "contains",
          "not_contains",
          "regex",
          "json_schema",
          "tool_called",
        ]),
        value: z.string().max(65536),
      }),
    )
    .max(100)
    .default([]),
});
export type CreateEvalCaseInput = z.infer<typeof createEvalCaseSchema>;

export const evalResultSchema = z.object({
  caseId: idSchema,
  passed: z.boolean(),
  output: z.string(),
  failures: z.array(z.string()),
  latencyMs: z.number().int(),
  costUsd: z.number(),
});
export type EvalResult = z.infer<typeof evalResultSchema>;

export const evalRunSchema = z.object({
  id: idSchema,
  datasetId: idSchema,
  agentRevisionId: idSchema,
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  results: z.array(evalResultSchema),
  error: z.string().nullable(),
  createdAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
});
export type EvalRun = z.infer<typeof evalRunSchema>;

export const startEvalRunSchema = z.object({
  datasetId: idSchema,
});
export type StartEvalRunInput = z.infer<typeof startEvalRunSchema>;
