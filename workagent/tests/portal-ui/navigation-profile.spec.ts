import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/me") {
      await route.fulfill({ json: { user: { id: "user-1", orgId: "org-1", orgName: "示例企业", email: "user@example.test", name: "林岚", role: "member", avatarUrl: null } } });
      return;
    }
    if (path === "/v1/personal-assistant") {
      await route.fulfill({ json: { agent: { id: "agent-1", name: "需求搭档", description: "需求梳理", status: "published", visibility: "private", profile: { name: "需求搭档", avatar: "leaf", role: "需求分析伙伴", mission: "拆解复杂需求", selfIntroduction: "先整理事实", userContext: "负责产品规划", styleTags: ["先结论", "严谨"], personalSkills: [], knowledgeEntries: [], memoryEntries: [], purpose: "协助梳理需求", preferences: "不确定时先确认" }, activeVersion: 3 }, readiness: { definitionReady: true, modelConfigured: true, canExecute: true } } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
});

test("shows every Portal destination as one flat header menu", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "员工工作导航" });
  await expect(navigation.getByRole("link")).toHaveCount(10);
  await expect(page.getByRole("navigation", { name: "Portal 分组" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "搭档档案" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "对话" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "自动化" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "项目" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "授权" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "消耗" })).toBeVisible();
  for (const label of ["成长", "记忆", "技能", "知识", "授权", "设备", "消耗"]) {
    await expect(navigation.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(navigation.getByRole("link", { name: "内容" })).toHaveCount(0);
});

test("saves a personal skill into the private assistant context", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  let currentProfile = { name: "需求搭档", avatar: "leaf", role: "需求分析伙伴", mission: "拆解复杂需求", selfIntroduction: "先整理事实", userContext: "负责产品规划", styleTags: ["先结论", "严谨"], personalSkills: [] as { name: string; instruction: string }[], knowledgeEntries: [], memoryEntries: [], purpose: "协助梳理需求", preferences: "不确定时先确认" };
  await page.route("**/v1/personal-assistant", async (route) => {
    if (route.request().method() === "PUT") {
      payload = route.request().postDataJSON() as Record<string, unknown>;
      currentProfile = payload as typeof currentProfile;
    }
    await route.fulfill({ json: { agent: { id: "agent-1", profile: currentProfile, activeVersion: 3 }, readiness: { canExecute: true } } });
  });
  await page.goto("/skills");
  await page.getByRole("button", { name: "新增技能" }).click();
  await page.getByLabel("技能名称").fill("会议纪要整理");
  await page.getByLabel("工作方法").fill("列出结论、行动项和负责人");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("生成新的私人指令版本");
  expect(payload?.personalSkills).toEqual([{ name: "会议纪要整理", instruction: "列出结论、行动项和负责人" }]);
  await expect(page.getByText("会议纪要整理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("工作方法").fill("列出结论、行动项、负责人和期限");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("列出结论、行动项、负责人和期限")).toBeVisible();
  await page.getByRole("button", { name: "删除个人技能 1" }).click();
  await expect(page.getByText("还没有个人技能")).toBeVisible();
  expect(payload?.personalSkills).toEqual([]);
});

test("renders growth, published content and session controls from service data", async ({ page }) => {
  await page.route("**/v1/personal-growth", (route) => route.fulfill({ json: { summary: { revisions: 3, runs: 8, succeeded: 6, failed: 2, activeVersion: 3 }, items: [] } }));
  await page.route("**/v1/portal-content", (route) => route.fulfill({ json: { items: [{ id: "notice-1", title: "季度安排", slug: "quarter", summary: "本季度工作安排", publishedAt: "2026-11-01T00:00:00Z" }] } }));
  await page.route("**/v1/auth/sessions", (route) => route.fulfill({ json: { items: [{ id: "session-1", userAgent: "Browser Test", ipAddress: "127.0.0.1", createdAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-08T00:00:00Z", current: false }] } }));
  await page.goto("/growth");
  await expect(page.getByText("近 30 天执行")).toBeVisible();
  await page.goto("/content");
  await expect(page.getByRole("link", { name: "查看内容" })).toBeVisible();
  await page.goto("/devices");
  await expect(page.getByText("Browser Test")).toBeVisible();
  let revoked = "";
  await page.route("**/v1/auth/sessions/**", async (route) => {
    revoked = route.request().method();
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("button", { name: "结束会话" }).click();
  await expect.poll(() => revoked).toBe("DELETE");
});

test("shows expanded personal identity, user context and real capability boundary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("需求分析伙伴", { exact: true })).toBeVisible();
  await expect(page.getByText("拆解复杂需求", { exact: true })).toBeVisible();
  await expect(page.getByText("负责产品规划", { exact: true })).toBeVisible();
  await expect(page.getByText("工具与外部连接")).toBeVisible();
  await expect(page.getByText("未启用").first()).toBeVisible();
});
