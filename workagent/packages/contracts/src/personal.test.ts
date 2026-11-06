import { describe, expect, it } from "vitest";
import { personalProfileSchema } from "./personal.js";

describe("personal assistant profile", () => {
  it("upgrades older three-field profiles with empty editable identity sections", () => {
    expect(personalProfileSchema.parse({ name: "工作搭档", purpose: "整理需求", preferences: "先给结论" })).toEqual({
      name: "工作搭档",
      avatar: "spark",
      role: "",
      mission: "",
      selfIntroduction: "",
      userContext: "",
      styleTags: [],
      personalSkills: [],
      knowledgeEntries: [],
      memoryEntries: [],
      purpose: "整理需求",
      preferences: "先给结论",
    });
  });

  it("bounds style tags and user-provided context", () => {
    expect(personalProfileSchema.safeParse({ name: "搭档", purpose: "工作", styleTags: Array(9).fill("简洁") }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ name: "搭档", purpose: "工作", userContext: "x".repeat(4001) }).success).toBe(false);
  });

  it("accepts bounded private skills, knowledge and user-curated memories", () => {
    const result = personalProfileSchema.parse({
      name: "搭档",
      purpose: "整理工作",
      personalSkills: [{ name: "会议整理", instruction: "提取结论、行动项和负责人" }],
      knowledgeEntries: [{ title: "团队术语", content: "项目负责人简称 PM" }],
      memoryEntries: [{ content: "用户偏好先看结论" }],
    });
    expect(result.personalSkills[0]?.name).toBe("会议整理");
    expect(result.knowledgeEntries[0]?.title).toBe("团队术语");
    expect(result.memoryEntries[0]?.content).toContain("先看结论");
  });

  it("rejects oversized or malformed private context", () => {
    expect(personalProfileSchema.safeParse({ name: "搭档", purpose: "整理工作", personalSkills: Array(13).fill({ name: "技能", instruction: "内容" }) }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ name: "搭档", purpose: "整理工作", memoryEntries: Array(20).fill({ content: "x".repeat(1000) }), knowledgeEntries: Array(20).fill({ title: "知识", content: "x".repeat(3000) }) }).success).toBe(false);
  });
});
