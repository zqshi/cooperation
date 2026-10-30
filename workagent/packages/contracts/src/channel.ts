import { z } from "zod";
import { idSchema, timestampSchema } from "./common.js";

export const channelTypeSchema = z.enum([
  "feishu",
  "dingtalk",
  "wecom",
  "slack",
  "mock",
]);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const channelAccountSchema = z.object({
  id: idSchema,
  type: channelTypeSchema,
  name: z.string(),
  status: z.enum(["active", "disabled"]),
  appId: z.string().nullable(),
  defaultAgentId: idSchema.nullable(),
  createdAt: timestampSchema,
});
export type ChannelAccount = z.infer<typeof channelAccountSchema>;

export const createChannelAccountSchema = z.object({
  type: channelTypeSchema,
  name: z.string().min(1).max(100),
  appId: z.string().max(200).default(""),
  appSecret: z.string().max(4000).default(""),
  verificationToken: z.string().max(4000).default(""),
  encryptKey: z.string().max(4000).default(""),
  defaultAgentId: idSchema.optional(),
});
export type CreateChannelAccountInput = z.infer<
  typeof createChannelAccountSchema
>;

export const inboundChannelMessageSchema = z.object({
  channel: channelTypeSchema,
  accountId: idSchema,
  externalUserId: z.string().min(1),
  externalUserName: z.string().default(""),
  externalConversationId: z.string().min(1),
  externalMessageId: z.string().min(1),
  text: z.string().min(1),
  isGroup: z.boolean().default(false),
  raw: z.unknown().optional(),
});
export type InboundChannelMessage = z.infer<typeof inboundChannelMessageSchema>;

export const outboundChannelMessageSchema = z.object({
  accountId: idSchema,
  channel: channelTypeSchema,
  externalConversationId: z.string().min(1),
  text: z.string(),
  title: z.string().optional(),
  url: z.string().url().optional(),
  kind: z.enum(["text", "card", "approval", "result"]).default("text"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type OutboundChannelMessage = z.infer<
  typeof outboundChannelMessageSchema
>;

export const channelBindingSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  userId: idSchema,
  externalUserId: z.string(),
  externalConversationId: z.string().nullable(),
  createdAt: timestampSchema,
});
export type ChannelBinding = z.infer<typeof channelBindingSchema>;
