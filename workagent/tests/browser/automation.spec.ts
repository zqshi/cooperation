import { test, expect } from "@playwright/test";
const root = "http://127.0.0.1:16174";
test("automation CRUD, trigger, real history/detail, reload, sibling tabs and responsive screenshots", async ({
  page,
}) => {
  await page.context().addCookies([
    {
      name: "wa_session",
      value: "isolated-project-executor-cookie",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(root + "/automations");
  const nav = page.getByRole("navigation", { name: "员工工作导航" });
  await expect(nav.getByRole("link")).toHaveCount(2);
  await expect(
    nav.getByRole("link", { name: "自动化", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "新建自动化", exact: true }).click();
  let form = page.getByRole("dialog", { name: "新建自动化", exact: true });
  await form.getByLabel("任务标题").fill("每周复盘自动化");
  await form
    .getByLabel("任务描述", { exact: true })
    .fill("请根据以下内容整理复盘：本周完成需求评审，下周进行测试。");
  await form.getByLabel("时区", { exact: true }).fill("Asia/Shanghai");
  await form.getByLabel("频率", { exact: true }).selectOption("weekly");
  await form.getByLabel("星期", { exact: true }).selectOption("1");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/automation/form-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await form.getByRole("button", { name: "创建自动化", exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/[^/]+$/);
  const url = page.url();
  const id = url.split("/").pop()!;
  await expect(
    page.getByRole("heading", { name: "每周复盘自动化", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("0 9 * * 1", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑日程", exact: true }).click();
  form = page.getByRole("dialog", { name: "编辑自动化", exact: true });
  await form.getByLabel("任务标题").fill("复盘日程已更新");
  await form.getByLabel("执行方式").selectOption("once");
  await form.getByLabel("执行日期和时间").fill("2090-06-01T09:00");
  await form.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "复盘日程已更新", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "立即执行", exact: true }).click();
  await expect(page.getByText("排队中", { exact: true })).toBeVisible();
  // Test harness drains only this owned automation through the real engine. The
  // production worker/outbox recovery is covered by the isolated API suite.
  const drained = await page.request.post(
    "http://127.0.0.1:16100/mock/automation-drain",
    { data: { id }, headers: { origin: root } },
  );
  expect(drained.ok(), await drained.text()).toBe(true);
  await page.reload();
  await expect(page.getByText("成功", { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/automation/detail-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("link", { name: "查看执行详情 →" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/runs\//);
  await expect(
    page.getByRole("link", { name: "返回自动化", exact: true }),
  ).toHaveAttribute("href", `/automations/${id}`);
  await page.reload();
  await expect(
    page
      .getByText("请根据以下内容整理复盘：本周完成需求评审，下周进行测试。", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.goto(url);
  await nav.getByRole("link", { name: "项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目协作", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "项目", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "自动化", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /复盘日程已更新/ }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/automation/list-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("link", { name: /复盘日程已更新/ }).click();
  await page.getByRole("button", { name: "终止", exact: true }).click();
  await page.getByRole("button", { name: "确认终止", exact: true }).click();
  await expect(page.getByText("已终止", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "立即执行", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page).toHaveURL(root + "/automations");
  await page.reload();
  await expect(page.getByRole("link", { name: /复盘日程已更新/ })).toHaveCount(
    0,
  );
  const h = await page.request.get(
    `http://127.0.0.1:16100/v1/automations/${id}/history`,
  );
  expect((await h.json()).items[0].status).toBe("succeeded");
});
