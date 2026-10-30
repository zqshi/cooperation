import { z } from "zod";

export const idSchema = z.string().min(1).max(64);
export const timestampSchema = z.string().datetime();

export const roleSchema = z.enum(["owner", "admin", "builder", "operator", "user", "auditor"]);
export type Role = z.infer<typeof roleSchema>;

export const visibilitySchema = z.enum(["private", "org", "public"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  now: z.string().datetime(),
});

export const emptySchema = z.object({});
