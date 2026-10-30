import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
const consoleUrl = "http://127.0.0.1:16173";
const portalUrl = "http://127.0.0.1:16174";
async function capture(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".animate-spin")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/evidence/recovery/${name}-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
}
test("platform opens tenant, owner signs in, builds and persists Agent without a model key", async ({
  page,
  browser,
}) => {
  await page.goto(`${consoleUrl}/super-admin/tenants`);
  await page.getByLabel("平台邮箱").fill("reviewer@browser.test");
  await page.getByLabel("平台密码").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录平台运营" }).click();
  await page.getByRole("button", { name: "创建租户", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("企业名称").fill("远山设计协作社");
  await dialog.getByLabel("企业标识").fill("recovery-browser-tenant");
  await dialog.getByLabel("负责人姓名").fill("林悦");
  await dialog.getByLabel("负责人邮箱").fill("owner@recovery-browser.test");
  await dialog.getByLabel("初始密码").fill("Recovery-Browser-2026!");
  await dialog.getByLabel("订阅方案").selectOption("team");
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/platform/tenants") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "创建并开通负责人" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(await response.text()).not.toContain("Recovery-Browser-2026!");
  await expect(
    page.getByRole("heading", { name: "远山设计协作社" }),
  ).toBeVisible();
  await capture(page, "platform-detail");
  await page.goto(`${consoleUrl}/super-admin/tenants`);
  await page.getByLabel("搜索租户").fill("远山");
  await expect(
    page.getByRole("link", { name: "远山设计协作社" }),
  ).toBeVisible();
  await capture(page, "platform-tenants");
  await page.goto(`${consoleUrl}/super-admin/audit`);
  await expect(page.getByText("创建租户", { exact: true })).toBeVisible();
  await capture(page, "platform-audit");
  await page.goto(`${consoleUrl}/super-admin`);
  await capture(page, "platform-overview");
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    await owner.goto(`${consoleUrl}/tenant`);
    await owner
      .locator("input[type=email]")
      .fill("owner@recovery-browser.test");
    await owner.locator("input[type=password]").fill("Recovery-Browser-2026!");
    await owner.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      owner.getByRole("heading", { name: "企业总览" }),
    ).toBeVisible();
    await owner.goto(`${consoleUrl}/tenant/skills`);
    await owner
      .getByRole("button", { name: "新建 Skill", exact: true })
      .click();
    const sd = owner.getByRole("dialog");
    await sd.getByLabel("名称", { exact: true }).fill("交付检查");
    await sd
      .getByLabel("指令", { exact: false })
      .fill("交付前检查所有待办均有明确负责人，未知信息标注待确认。");
    await sd.getByRole("button", { name: /保存|创建/ }).click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await owner.goto(`${consoleUrl}/tenant/agents`);
    await owner
      .getByRole("button", { name: "新建 Agent", exact: true })
      .click();
    await owner.getByLabel("起步定义").selectOption("meeting");
    await owner.getByRole("button", { name: "创建草稿", exact: true }).click();
    await expect(owner).toHaveURL(/\/tenant\/agents\/[^/]+$/);
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(owner.getByLabel("系统指令")).toBeVisible();
    await owner.getByLabel("名称", { exact: true }).fill("会议行动整理助手");
    await owner.getByLabel("交付检查", { exact: false }).check();
    await expect(
      owner.getByText("有未保存修改", { exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(owner.getByText("已保存", { exact: true })).toBeVisible();
    await owner.reload();
    await expect(owner.getByLabel("名称", { exact: true })).toHaveValue(
      "会议行动整理助手",
    );
    await expect(owner.getByLabel("交付检查", { exact: false })).toBeChecked();
    await capture(owner, "agent-builder");
    await owner.getByRole("button", { name: "预览", exact: true }).click();
    await expect(
      owner.getByText("模型服务尚未配置。", { exact: false }),
    ).toBeVisible();
    await expect(
      owner.getByRole("button", { name: "运行预览" }),
    ).toBeDisabled();
    await capture(owner, "agent-preview");
    await owner
      .getByRole("button", { name: "评测与发布", exact: true })
      .click();
    await capture(owner, "agent-release");
    await owner.goto(`${consoleUrl}/tenant/overview`);
    await capture(owner, "tenant-overview");
    await owner.goto(`${consoleUrl}/super-admin`);
    await expect(
      owner.getByRole("button", { name: "登录平台运营" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  await page.goto(`${portalUrl}/workbench`);
  await page.locator("input[type=email]").fill("reviewer@browser.test");
  await page.locator("input[type=password]").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目协作", exact: true }),
  ).toBeVisible();
  await page.goto(`${portalUrl}/personal-runs`);
  await page.getByRole("link").filter({ hasText: "默认项目" }).click();
  await page.getByRole("button", { name: "执行记录", exact: true }).click();
  await expect(
    page.getByText("请审核这份项目交付说明", { exact: true }),
  ).toBeVisible();
  await capture(page, "employee-inbox");
  await page.goto(`${consoleUrl}/tenant/overview`);
  await expect(
    page.getByRole("heading", { name: "企业总览", exact: true }),
  ).toBeVisible();
  await capture(page, "tenant-overview-populated");
});

test("result download and independent run acceptance persist across reload", async ({
  page,
}) => {
  await page.goto(`${portalUrl}/workbench`);
  await page.locator("input[type=email]").fill("reviewer@browser.test");
  await page.locator("input[type=password]").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目协作", exact: true }),
  ).toBeVisible();
  await page.goto(`${portalUrl}/tasks/ux-delivery`);
  await expect(
    page.getByRole("link", { name: "下载", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("交付检查清单.txt");
  expect(await file.failure()).toBeNull();
  expect(await fs.readFile((await file.path())!, "utf8")).toContain(
    "Synthetic isolated fixture:",
  );
  await page.getByPlaceholder("验收意见").fill("交付检查清单已核对。");
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  await expect(
    page.getByText("交付检查清单已核对。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("交付检查清单已核对。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "验收通过", exact: true }),
  ).toHaveCount(0);
  await capture(page, "run-output-accepted");
  await page.goto(`${portalUrl}/tasks/ux-failed`);
  await expect(
    page.getByText("本次执行未完成。", { exact: false }),
  ).toBeVisible();
  await capture(page, "run-failed");
});
