import { chromium, expect, type Page } from "@playwright/test";
const portal =
  process.env.TEST_PRODUCTION_PORTAL ??
  "https://portal.workagent.localhost:15443";
const consoleOrigin =
  process.env.TEST_PRODUCTION_CONSOLE ??
  "https://console.workagent.localhost:15443";
const browser = await chromium.launch({ headless: true });
const reviewer = await browser.newContext({ ignoreHTTPSErrors: true });
const executor = await browser.newContext({ ignoreHTTPSErrors: true });
async function login(page: Page, who: string) {
  await page.goto(portal + "/projects");
  await page.locator("input[type=email]").fill(`${who}@fixture.test`);
  await page.locator("input[type=password]").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目协作" })).toBeVisible();
}
try {
  const page = await reviewer.newPage();
  await login(page, "prod-reviewer");
  const project = `Production browser ${Date.now()}`;
  await page.getByLabel("项目名称").fill(project);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目任务看板" }),
  ).toBeVisible();
  await page
    .getByLabel("企业成员")
    .selectOption({ label: "prod-executor (prod-executor@fixture.test)" });
  await page.getByLabel("权限").selectOption("contributor");
  await page.getByRole("button", { name: "添加或更新权限" }).click();
  await expect(
    page.getByText("prod-executor · prod-executor@fixture.test · contributor"),
  ).toBeVisible();
  await page.getByLabel("任务标题").fill("Production independent acceptance");
  await page
    .getByLabel("上下文与验收要求")
    .fill("Executor submits; another manager accepts.");
  await page.getByLabel("执行者").selectOption({ label: "prod-executor" });
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Production independent acceptance",
      exact: true,
    }),
  ).toBeVisible();
  const cookies = await reviewer.cookies();
  expect(cookies.find((c) => c.name === "wa_session")?.secure).toBe(true);
  expect(cookies.find((c) => c.name === "wa_session")?.httpOnly).toBe(true);
  const work = await executor.newPage();
  await login(work, "prod-executor");
  await work.getByRole("button", { name: project, exact: true }).click();
  await work.getByRole("button", { name: "开始", exact: true }).click();
  await work.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(
    work.getByRole("button", { name: "验收通过", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: project, exact: true }).click();
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "验收通过", exact: true }),
  ).toHaveCount(0);
  await page.goto(consoleOrigin + "/super-admin");
  await expect(
    page.getByRole("button", { name: "登录平台运营" }),
  ).toBeVisible();
  await page.getByLabel("平台邮箱").fill("prod-platform@fixture.test");
  await page.getByLabel("平台密码").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录平台运营" }).click();
  await expect(page.getByText(/租户总数/)).toBeVisible();
  console.log(
    "PASS: production HTTPS containers, secure cookie login, task board, executor submission, independent acceptance, and separate platform login",
  );
} finally {
  await browser.close();
}
