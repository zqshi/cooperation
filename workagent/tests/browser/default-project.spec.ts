import { test, expect } from "@playwright/test";
const root = "http://127.0.0.1:16174";
test("private default directory, old links, reload and real unassigned execution context", async ({
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
  await page.goto(root + "/personal-runs");
  await expect(page).toHaveURL(root + "/projects");
  await expect(
    page.getByRole("link", { name: "个人执行历史", exact: true }),
  ).toHaveCount(0);
  const card = page.locator(".wa-project-card").filter({ hasText: "默认项目" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("置顶 · 私有默认项目");
  expect(
    await page.locator(".wa-project-card").first().textContent(),
  ).toContain("默认项目");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/default-project/directory-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await card.click();
  const projectId = new URL(page.url()).searchParams.get("project");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "默认项目", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "项目成员", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "添加成员", exact: true }),
  ).toHaveCount(0);
  const profile = await (
    await page.request.get(root + "/v1/personal-assistant")
  ).json();
  const created = await page.request.post(root + "/v1/runs", {
    data: {
      agentId: profile.agent.id,
      message: "默认项目中保留的真实个人执行",
    },
    headers: { origin: root },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const runId = (await created.json()).run.id;
  for (const legacy of ["personal-runs", "runs", "tasks"]) {
    await page.goto(`${root}/${legacy}/${runId}`);
    await expect(page).toHaveURL(`${root}/projects/${projectId}/runs/${runId}`);
    await expect(
      page.getByRole("link", { name: "返回项目执行", exact: true }),
    ).toHaveAttribute("href", `/projects?project=${projectId}&tab=runs`);
    await page.reload();
    await expect(
      page.getByRole("link", { name: "返回项目执行", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: "返回项目执行", exact: true }).click();
  await expect(page).toHaveURL(
    `${root}/projects?project=${projectId}&tab=runs`,
  );
  await expect(
    page.getByRole("heading", { name: "执行记录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("默认项目中保留的真实个人执行", { exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-results/evidence/default-project/runs-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
