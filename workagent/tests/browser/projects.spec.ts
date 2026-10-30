import { test, expect, type Page } from "@playwright/test";
async function login(p: Page, email: string) {
  await p.goto("http://127.0.0.1:16174/projects");
  await p.locator("input[type=email]").fill(email);
  await p.locator("input[type=password]").fill("Browser-test-2026!");
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await expect(p.getByRole("heading", { name: "项目协作" })).toBeVisible();
}
async function project(p: Page, name: string) {
  await p.getByRole("button", { name: "新建项目", exact: true }).click();
  await p.getByLabel("项目名称").fill(name);
  await p.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(p.getByRole("heading", { name, exact: true })).toBeVisible();
}
test("real project board, URL context and separate platform gate", async ({
  page,
}) => {
  await login(page, "reviewer@browser.test");
  await project(page, "Browser acceptance");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务标题").fill("Browser task");
  await page.getByLabel("上下文与验收要求").fill("Keep human review separate");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByRole("button", { name: /Browser task/ }).click();
  await page.getByRole("button", { name: "编辑任务", exact: true }).click();
  await page
    .getByLabel("编辑上下文")
    .fill("先整理交付材料，列出缺项，并保留独立复核。更新后的上下文。");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("更新后的上下文。");
  await page.getByRole("button", { name: "开始", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("执行中");
  const deep = page.url();
  await page.reload();
  expect(page.url()).toBe(deep);
  await expect(page.getByRole("dialog")).toContainText("Browser task");
  await page.getByRole("dialog").getByLabel("关闭").click();
  await page.goto("http://127.0.0.1:16173/super-admin");
  await expect(
    page.getByRole("button", { name: "登录平台运营" }),
  ).toBeVisible();
});
test("executor submits and a different project manager accepts", async ({
  page,
  browser,
}) => {
  await login(page, "reviewer@browser.test");
  await project(page, "Independent review browser");
  await page.getByRole("button", { name: "项目成员", exact: true }).click();
  await page
    .getByLabel("企业成员")
    .selectOption({ label: "executor (executor@browser.test)" });
  await page.getByLabel("权限", { exact: true }).selectOption("contributor");
  await page.getByRole("button", { name: "添加或更新权限" }).click();
  await expect(
    page.getByText("executor · executor@browser.test · 参与协作"),
  ).toBeVisible();
  await page.getByRole("button", { name: "任务看板", exact: true }).click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务标题").fill("Human acceptance");
  await page
    .getByLabel("上下文与验收要求")
    .fill("整理交付清单、核对资料与负责人，由另一位项目管理成员复核后验收。");
  await page.getByLabel("执行者", { exact: true }).selectOption("executor");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  const url = page.url();
  const context = await browser.newContext();
  try {
    const executor = await context.newPage();
    await login(executor, "executor@browser.test");
    await executor.goto(url);
    await executor.getByRole("button", { name: /Human acceptance/ }).click();
    await executor.getByRole("button", { name: "开始", exact: true }).click();
    await executor
      .getByRole("button", { name: "提交验收", exact: true })
      .click();
    await expect(
      executor.getByRole("button", { name: "验收通过", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /Human acceptance/ }).click();
    await page.getByRole("button", { name: "验收通过", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("已验收");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: `test-results/evidence/recovery/project-task-drawer-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.getByRole("dialog").getByLabel("关闭").click();
    await page.getByRole("button", { name: "项目动态", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "验收通过", exact: true }),
    ).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: `test-results/evidence/recovery/project-activity-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  } finally {
    await context.close();
  }
});
