import { z } from "zod";
// Local avatar glyphs avoid fetching untrusted URLs or copying vendor identities.
const personalSkillSchema = z.object({
  name: z.string().trim().min(1).max(80),
  instruction: z.string().trim().min(1).max(3000),
}).strict();
const personalKnowledgeSchema = z.object({
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(3000),
}).strict();
const personalMemorySchema = z.object({
  content: z.string().trim().min(1).max(1000),
}).strict();

export const personalProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    avatar: z.enum(["spark", "leaf", "star", "sun"]).default("spark"),
    role: z.string().trim().max(160).default(""),
    mission: z.string().trim().max(800).default(""),
    selfIntroduction: z.string().trim().max(2000).default(""),
    userContext: z.string().trim().max(4000).default(""),
    styleTags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    personalSkills: z.array(personalSkillSchema).max(12).default([]),
    knowledgeEntries: z.array(personalKnowledgeSchema).max(20).default([]),
    memoryEntries: z.array(personalMemorySchema).max(20).default([]),
    purpose: z.string().trim().min(1).max(2000),
    preferences: z.string().trim().max(4000).default(""),
  })
  .strict()
  .superRefine((profile, context) => {
    const contextSize = profile.personalSkills.reduce((n, item) => n + item.name.length + item.instruction.length, 0)
      + profile.knowledgeEntries.reduce((n, item) => n + item.title.length + item.content.length, 0)
      + profile.memoryEntries.reduce((n, item) => n + item.content.length, 0);
    if (contextSize > 24000) context.addIssue({ code: "custom", message: "个人上下文总长度不能超过 24000 个字符" });
  });
export type PersonalProfile = z.infer<typeof personalProfileSchema>;
