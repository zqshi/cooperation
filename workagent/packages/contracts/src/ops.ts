import { z } from "zod";
import { idSchema, timestampSchema } from "./common.js";

export const auditLogSchema = z.object({
  id: idSchema,
  actorId: idSchema.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: timestampSchema,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const usageRecordSchema = z.object({
  id: idSchema,
  runId: idSchema.nullable(),
  agentId: idSchema.nullable(),
  userId: idSchema.nullable(),
  kind: z.enum(["model", "sandbox", "storage", "tool"]),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  quantity: z.number(),
  costUsd: z.number(),
  createdAt: timestampSchema,
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;

export const usageSummarySchema = z.object({
  from: timestampSchema,
  to: timestampSchema,
  totalCostUsd: z.number(),
  totalRuns: z.number().int(),
  totalInputTokens: z.number().int(),
  totalOutputTokens: z.number().int(),
  byAgent: z.array(
    z.object({
      agentId: idSchema,
      name: z.string(),
      runs: z.number().int(),
      costUsd: z.number(),
    }),
  ),
  byDay: z.array(
    z.object({ date: z.string(), runs: z.number().int(), costUsd: z.number() }),
  ),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const quotaSchema = z.object({
  id: idSchema,
  scope: z.enum(["org", "agent", "user"]),
  scopeId: idSchema,
  monthlyBudgetUsd: z.number(),
  monthlyRunLimit: z.number().int(),
  currentCostUsd: z.number(),
  currentRuns: z.number().int(),
});
export type Quota = z.infer<typeof quotaSchema>;

export const dashboardStatsSchema = z.object({
  agents: z.number().int(),
  publishedAgents: z.number().int(),
  runsToday: z.number().int(),
  successRate7d: z.number(),
  pendingApprovals: z.number().int(),
  costMonthUsd: z.number(),
  activeUsers7d: z.number().int(),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const tenantConfigurationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    plan: z.enum(["trial", "team", "enterprise"]),
    industry:z.string().trim().max(120).default(''),
    companySize:z.string().trim().max(80).default(''),
    contactPhone:z.string().trim().max(80).default(''),
    description:z.string().max(2000).default(''),
  })
  .strict();
export const createTenantSchema = tenantConfigurationSchema
  .extend({
    slug: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    ownerName: z.string().trim().min(1).max(120),
    ownerEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    ownerPassword: z
      .string()
      .min(16)
      .refine(
        (v) => new TextEncoder().encode(v).length <= 72,
        "密码最多 72 UTF-8 字节",
      ),
  })
  .strict();
export const platformPaginationSchema = z.object({
  search: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PlatformTenantDetail = import("./project.js").PlatformTenant & {
  agentCount: number;
  runCount: number;
  storageBytes: number;
  costUsd: number;
};
export type PlatformAuditRow = {
  id: string;
  userId: string;
  userEmail:string;
  action: string;
  orgId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
export type TenantHome = {
  portalOrigin: string;
  counts: {
    agents: number;
    published: number;
    runs: number;
    failed: number;
    pending: number;
    knowledge: number;
    channels: number;
  };
  readiness: {
    modelConfigured: boolean;
    publishedAgent: boolean;
    configuredChannels: number;
    verifiedChannels: null;
  };
  recent: {
    id: string;
    status: string;
    agentName: string;
    createdAt: string;
  }[];
};
