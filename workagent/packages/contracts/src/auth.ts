import { z } from "zod";
import { idSchema, roleSchema, timestampSchema } from "./common.js";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .max(72)
    .refine(
      (v) => new TextEncoder().encode(v).length <= 72,
      "Password must be at most 72 UTF-8 bytes",
    ),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const sessionUserSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  orgName: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: roleSchema,
  avatarUrl: z.string().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const memberSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string(),
  role: roleSchema,
  status: z.enum(["active", "invited", "disabled"]),
  createdAt: timestampSchema,
});
export type Member = z.infer<typeof memberSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: roleSchema.default("user"),
  password: z
    .string()
    .min(8)
    .max(72)
    .refine(
      (v) => new TextEncoder().encode(v).length <= 72,
      "Password must be at most 72 UTF-8 bytes",
    )
    .optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({
  role: roleSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const orgSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  plan: z.enum(["trial", "team", "enterprise"]),
  createdAt: timestampSchema,
});
export type Org = z.infer<typeof orgSchema>;
