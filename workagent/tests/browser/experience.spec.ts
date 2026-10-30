import { test, expect } from "@playwright/test";
const consoleUrl = "http://127.0.0.1:16173";
const portalUrl = "http://127.0.0.1:16174";
async function login(page: import("@playwright/test").Page, url: string) {
  await page.goto(url);
  await page.locator("input[type=email]").fill("reviewer@browser.test");
  await page.locator("input[type=password]").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
}
test("role navigation, disconnected IM, responsive layout and platform session isolation", async ({
  page,
}) => {
  await login(page, `${consoleUrl}/tenant`);
  await expect(page.getByRole("heading", { name: "企业总览" })).toBeVisible();
  await expect(page.locator('nav a[href="/super-admin"]')).toHaveCount(0);
  await page.goto(`${consoleUrl}/tenant/agents`);
  await page.getByRole("button", { name: "新建 Agent", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "新建 Agent", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("关闭")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新建 Agent", exact: true }),
  ).toBeFocused();
  await page.goto(`${consoleUrl}/tenant/usage`);
  await expect(page.getByRole("heading", { name: "成本与配额" })).toBeVisible();
  await expect(
    page.getByText("$1.25 / $100.00", { exact: false }),
  ).toBeVisible();
  await page.goto(`${consoleUrl}/super-admin`);
  await expect(
    page.getByRole("button", { name: "登录平台运营" }),
  ).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByText("Admin", { exact: true })).toHaveCount(0);
  await page.getByLabel("平台邮箱").fill("reviewer@browser.test");
  await page.getByLabel("平台密码").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录平台运营" }).click();
  await expect(page.getByRole("heading", { name: "平台运营" })).toBeVisible();
  await expect(page.getByText("平台管理员", { exact: true })).toBeVisible();
  await expect(page.locator('nav a[href="/tenant"]')).toHaveCount(0);
  await page.getByRole("button", { name: "退出平台" }).click();
  await expect(
    page.getByRole("button", { name: "登录平台运营" }),
  ).toBeVisible();
  await page.goto(`${consoleUrl}/tenant`);
  await expect(page.getByRole("heading", { name: "企业总览" })).toBeVisible();
  await page.goto(`${portalUrl}/workbench`);
  await expect(
    page.getByRole("heading", { name: "项目协作", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${portalUrl}/projects`);
  await page.goto(`${portalUrl}/authorization`);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ["", "/projects", "/tasks", "/approvals"]) {
      await page.goto(`${portalUrl}${path}`);
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto(`${consoleUrl}/tenant/channels`);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("populated run, approval and project workspace render at desktop and mobile", async ({
  page,
}) => {
  await login(page, `${portalUrl}/projects`);
  await expect(page.getByRole("heading", { name: "项目协作" })).toBeVisible();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("UX screenshot project");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务标题").fill("准备项目交付说明");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /准备项目交付说明/ }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/experience/isolated-project-board-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const path of ["/tasks/ux-run"]) {
    await page.goto(`${portalUrl}${path}`);
    await expect(
      page.getByText("对外发布前需要人工审批", { exact: false }).first(),
    ).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/evidence/experience/isolated-${path === "/approvals" ? "approval" : "run"}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});
