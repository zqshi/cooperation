import { test, expect } from "@playwright/test";
const root = "http://127.0.0.1:16174";
async function login(page: import("@playwright/test").Page, who = "reviewer") {
  await page.context().addCookies([
    {
      name: "wa_session",
      value: `isolated-project-${who}-cookie`,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${root}/projects`);
  await expect(page.getByRole("heading", { name: "项目协作" })).toBeVisible();
}
test("project directory, scoped executions/deliveries/approvals and legacy deep links", async ({
  page,
}) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "员工工作导航" });
  await expect(nav.getByRole("link")).toHaveCount(2);
  await expect(
    nav.getByRole("link", { name: "项目", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      page.getByRole("link", { name: /项目交付回归/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/evidence/project-first/directory-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("link", { name: /项目交付回归/ }).click();
  await expect(page).toHaveURL(/\/projects\?project=.+/);
  const projectURL = page.url();
  const projectId = new URL(projectURL).searchParams.get("project")!;
  await page.getByRole("button", { name: "执行记录", exact: true }).click();
  await expect(page.getByText("第 1 次执行", { exact: false })).toHaveCount(2);
  await page.getByText("查看实际输出", { exact: true }).click();
  await expect(
    page.getByText("项目真实文本输出：交付清单已整理。"),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/project-first/runs-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "项目产物", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "项目交付清单.txt", exact: true }),
  ).toBeVisible();
  const download = await page.request.get(
    await page
      .getByRole("link", { name: "下载文件" })
      .getAttribute("href")
      .then((h) => `${root}${h}`),
  );
  expect(download.ok()).toBe(true);
  expect(await download.text()).toContain("Project-scoped synthetic delivery");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/project-first/artifacts-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "执行审批", exact: true }).click();
  await expect(page.getByText("项目发布前需要审批")).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/project-first/approvals-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("link", { name: "document.publish", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/runs/`));
  await expect(
    page.getByRole("button", { name: "继续对话", exact: true }),
  ).toHaveCount(0);
  const runId = page.url().split("/").pop()!;
  await page.goto(`${root}/tasks/${runId}`);
  await expect(page).toHaveURL(`${root}/projects/${projectId}/runs/${runId}`);
  await page.reload();
  await expect(page.getByText("项目执行记录 · 不替代任务验收")).toBeVisible();
  await page.getByRole("button", { name: "批准并继续", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "批准并继续", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "批准并继续", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /返回任务 · 发布材料审核/ }).click();
  await expect(page.getByRole("dialog")).toContainText("发布材料审核");
  await page.getByRole("dialog").getByLabel("关闭").click();
  await page.getByRole("link", { name: "← 全部项目" }).click();
  await page.getByRole("link", { name: /隔离项目/ }).click();
  await expect(
    page.getByRole("heading", { name: "隔离项目", exact: true }),
  ).toBeVisible();
  const isolatedId = new URL(page.url()).searchParams.get("project")!;
  for (const tab of ["执行记录", "项目产物", "执行审批"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByText("项目发布前需要审批")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "项目交付清单.txt", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("交付材料整理", { exact: true })).toHaveCount(
      0,
    );
  }
  await page.goto(`${root}/projects/${isolatedId}/runs/${runId}`);
  await expect(page.getByText("运行不属于此项目或不可访问")).toBeVisible();
  await page.goto(`${root}/personal-runs`);
  await expect(
    page.getByRole("heading", { name: "项目协作", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("发布材料审核", { exact: true })).toHaveCount(0);
  await page.goto(`${root}/projects?project=not-a-member`);
  await expect(
    page.getByRole("heading", { name: "项目不可访问" }),
  ).toBeVisible();
});
test("human planning without models, optional enterprise carrier and persisted task deep link", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.route("**/v1/execution-readiness", (route) =>
    route.fulfill({ json: { modelConfigured: false, canExecute: false } }),
  );
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("新产品发布计划");
  await page
    .getByLabel("说明", { exact: true })
    .fill("以项目任务管理交付，Agent 是可选的执行载体。");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\?project=.+/);
  const projectURL = page.url();
  const projectId = new URL(projectURL).searchParams.get("project")!;
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务标题").fill("准备人工交付计划");
  await page
    .getByLabel("上下文与验收要求")
    .fill("完成资料核对后由另一位项目管理成员验收。");
  await page.getByLabel("执行者", { exact: true }).selectOption("reviewer");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByRole("button", { name: /准备人工交付计划/ }).click();
  await expect(page.getByRole("dialog")).toContainText("人工执行");
  const deep = page.url();
  await page.reload();
  expect(page.url()).toBe(deep);
  await expect(page.getByRole("dialog")).toContainText("完成资料核对");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/project-first/task-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "编辑任务", exact: true }).click();
  await page.getByLabel("执行 Agent", { exact: true }).selectOption("ux-agent");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.getByRole("button", { name: "运行 Agent", exact: true }).click();
  await expect(page.getByRole("link", { name: "第 1 次执行 →" })).toBeVisible();
  await page.getByRole("link", { name: "第 1 次执行 →" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/runs/`));
  await expect(
    page.getByRole("link", { name: /返回任务 · 准备人工交付计划/ }),
  ).toBeVisible();
  const context = await browser.newContext();
  try {
    const outsider = await context.newPage();
    await login(outsider, "executor");
    await outsider.goto(projectURL);
    await expect(
      outsider.getByRole("heading", { name: "项目不可访问" }),
    ).toBeVisible();
    expect(
      (
        await outsider.request.get(`${root}/v1/projects/${projectId}/runs`)
      ).status(),
    ).toBe(404);
    await outsider.goto(page.url());
    await expect(
      outsider.getByRole("link", { name: /返回任务 · 准备人工交付计划/ }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
