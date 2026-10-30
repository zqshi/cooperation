import { z } from "zod";
export const productCategories = ["console", "user-portal"] as const;
export const projectRoleSchema = z.enum(["manager", "contributor", "viewer"]);
export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(4000).default(""),
  })
  .strict();
export const projectMemberInputSchema = z
  .object({ userId: z.string().min(1), role: projectRoleSchema })
  .strict();
export const projectSchema = createProjectSchema.extend({
  is_default: z.boolean().default(false),
  id: z.string(),
  org_id: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  role: projectRoleSchema,
});
export type Project = z.infer<typeof projectSchema>;
// Project tasks are planning records, never aliases for Agent runs. Task API is not implemented yet.
export const projectTaskSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
    status: z.enum(["todo", "doing", "done"]),
  })
  .strict();

export type PlatformOverview = {
  tenantCount: number;
  activeMemberCount: number;
};
export type PlatformTenant = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
  activeMemberCount: number;
};

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).default(""),
    assigneeId: z.string().min(1).nullable().default(null),
    agentId: z.string().min(1).nullable().default(null),
  })
  .strict();
export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20000).optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    agentId: z.string().min(1).nullable().optional(),
    version: z.number().int().positive(),
    status: z.enum(["todo", "doing", "review", "done"]).optional(),
  })
  .strict();
export type ProjectTask = {
  id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "review" | "done";
  assignee_id: string | null;
  agent_id: string | null;
  submitted_by: string | null;
  accepted_by: string | null;
  version: number;
};
