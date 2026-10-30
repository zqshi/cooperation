import { z } from "zod";
export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("once"), at: z.iso.datetime({ offset: true }) })
    .strict(),
  z
    .object({
      kind: z.literal("recurring"),
      cron: z.string().trim().min(9).max(100),
    })
    .strict(),
]);
export const automationInputSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(12000),
    timezone: z.string().trim().min(1).max(80),
    schedule: automationScheduleSchema,
    enabled: z.boolean().default(true),
  })
  .strict();
export const automationEditSchema = automationInputSchema
  .extend({ version: z.number().int().positive() })
  .strict();
export const automationActionSchema = z
  .object({
    action: z.enum(["pause", "resume", "terminate", "delete"]),
    version: z.number().int().positive(),
  })
  .strict();
export type AutomationInput = z.infer<typeof automationInputSchema>;
export type Automation = AutomationInput & {
  id: string;
  agentId: string;
  status: "active" | "paused" | "completed" | "terminated" | "deleted";
  version: number;
  nextAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AutomationOccurrence = {
  id: string;
  automationId: string;
  scheduledAt: string;
  trigger: "scheduled" | "manual";
  status: string;
  runId: string | null;
  output: string | null;
  error: string | null;
  createdAt: string;
};
