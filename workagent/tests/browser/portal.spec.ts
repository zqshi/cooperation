import { test, expect } from "@playwright/test";
const root = "http://127.0.0.1:16174";
test("personal Portal: ordinary employee provision, edit, reload, task entry and grouped responsive navigation", async ({
  page,
}) => {
  await page.goto(root);
  await page.locator("input[type=email]").fill("onboarding@browser.test");
  await page.locator("input[type=password]").fill("Browser-test-2026!");
  let releaseBootstrap!: () => void;
  let bootstrapRequested!: () => void;
  const pendingBootstrap = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  const requestedBootstrap = new Promise<void>((resolve) => {
    bootstrapRequested = resolve;
  });
  await page.route("**/v1/personal-assistant", async (route) => {
    bootstrapRequested();
    await pendingBootstrap;
    await route.continue();
  });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await requestedBootstrap;
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "创建我的搭档" })).toHaveCount(
    0,
  );
  await expect(page.getByText("正在加载", { exact: true })).toBeVisible();
  releaseBootstrap();
  await expect(
    page.getByRole("heading", { name: "创建我的搭档" }),
  ).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await page.unroute("**/v1/personal-assistant");

  await expect(
    page.getByRole("heading", { name: "创建我的搭档" }),
  ).toBeVisible();
  const assertCreationOnly = async () => {
    await expect(
      page.getByRole("heading", { name: "创建我的搭档" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.getByText("运行准备")).toHaveCount(0);
  };
  for (const path of [
    "/automations",
    "/automations/missing",
    "/workbench",
    "/projects?project=missing",
    "/tasks",
    "/tasks/missing",
    "/authorization",
    "/usage",
    "/approvals",
    "/conversations",
    "/agents",
  ]) {
    await page.goto(`${root}${path}`);
    await assertCreationOnly();
    await page.reload();
    await assertCreationOnly();
  }
  await page.route("**/v1/personal-assistant", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Profile temporarily unavailable" },
          }),
        })
      : route.continue(),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "无法加载搭档资料" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "创建我的搭档" })).toHaveCount(
    0,
  );
  await page.unroute("**/v1/personal-assistant");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await assertCreationOnly();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/portal/onboarding-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByLabel("搭档名称").fill("小禾 · 产品工作搭档");
  await page.getByLabel("头像", { exact: true }).selectOption("leaf");
  await page
    .getByLabel("工作职责")
    .fill("帮助我整理产品需求、起草周报；不确定的信息先向我澄清。");
  await page
    .getByLabel("协作偏好")
    .fill("先给结论，再说明依据。使用中文，保持简洁。");
  await page.route("**/v1/personal-assistant", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Creation unavailable" } }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "创建搭档", exact: true }).click();
  await expect(page.getByText("Creation unavailable")).toBeVisible();
  await expect(page.getByLabel("搭档名称")).toHaveValue("小禾 · 产品工作搭档");
  await expect(page.getByLabel("工作职责")).toHaveValue(
    "帮助我整理产品需求、起草周报；不确定的信息先向我澄清。",
  );
  await assertCreationOnly();
  await page.unroute("**/v1/personal-assistant");
  await page.getByRole("button", { name: "创建搭档", exact: true }).click();
  await expect(page).toHaveURL(`${root}/`);
  await expect(
    page.getByRole("navigation", { name: "Portal 分组" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "小禾 · 产品工作搭档" }),
  ).toBeVisible();
  await page.route("**/v1/personal-assistant", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        readiness: {
          definitionReady: true,
          modelConfigured: false,
          canExecute: false,
        },
      },
    });
  });
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Portal 分组" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "模型服务尚未配置。请联系企业管理员配置模型，随后即可执行。",
    ),
  ).toBeVisible();
  await page.unroute("**/v1/personal-assistant");
  await page.getByRole("button", { name: "编辑档案" }).click();
  await page.getByLabel("搭档名称").fill("小禾 · 我的产品搭档");
  await page.getByRole("button", { name: "保存档案" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "小禾 · 我的产品搭档" }),
  ).toBeVisible();
  await expect(page.getByText("定义已就绪 · 生效版本 v2")).toBeVisible();
  await page.getByRole("button", { name: "和搭档开始执行" }).click();
  await page.getByLabel("任务描述").fill("整理一份本周产品需求检查清单");
  await page.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/runs\/.+/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path, name] of [
      ["/", "profile"],
      ["/authorization", "authorization"],
      ["/usage", "usage"],
      ["/workbench", "workbench"],
      ["/projects", "projects"],
    ]) {
      await page.goto(`${root}${path}`);
      await expect(page.locator("h1")).toBeVisible();
      if (path === "/")
        await expect(
          page.getByRole("heading", { name: "小禾 · 我的产品搭档" }),
        ).toBeVisible();
      if (path === "/workbench")
        await expect(page).toHaveURL(`${root}/projects`);
      if (path === "/authorization")
        await expect(
          page.getByRole("heading", { name: "测试团队渠道 · feishu" }),
        ).toBeVisible();
      if (path === "/usage")
        await expect(
          page.getByRole("link", { name: "ux-deliv" }),
        ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/evidence/portal/${name}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.goto(root);
  await page
    .getByRole("navigation", { name: "Portal 分组" })
    .getByRole("link", { name: "任务协作" })
    .click();
  await expect(page).toHaveURL(`${root}/automations`);
  await page
    .getByRole("navigation", { name: "员工工作导航" })
    .getByRole("link", { name: "项目", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "员工工作导航" })
      .getByRole("link", { name: "项目", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("navigation", { name: "Portal 分组" })
    .getByRole("link", { name: "运行管理" })
    .click();
  await expect(page).toHaveURL(`${root}/authorization`);
  await page
    .getByRole("navigation", { name: "员工工作导航" })
    .getByRole("link", { name: "我的消耗" })
    .click();
  await expect(page).toHaveURL(`${root}/usage`);
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.locator("input[type=email]").fill("uncreated@browser.test");
  await page.locator("input[type=password]").fill("Browser-test-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await assertCreationOnly();
  await page.reload();
  await assertCreationOnly();
});
