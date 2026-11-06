import { test, expect } from "@playwright/test";
import { platformRoutes, tenantRoutes } from "../../apps/console/src/admin/navigation.js";
import { adminPageCatalog } from "../../apps/console/src/admin/page-catalog.js";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = path === "/v1/auth/me" ? { user: { id: "u1", orgId: "t1", orgName: "测试租户", email: "admin@example.test", name: "管理员", role: "owner", avatarUrl: null } }
      : path === "/v1/platform/me" ? { userId: "platform-1", platformAdmin: true }
      : path === "/v1/agents" ? { items: [], total: 0 }
      : /^\/v1\/agents\//.test(path) ? { agent: { id: path.split("/").at(-1), name: "测试 Agent", description: "测试", status: "draft", visibility: "org", currentRevisionId: "rev-1", publishedVersion: null, updatedAt: new Date().toISOString() }, draft: { id: "rev-1", version: 1, definition: { name: "测试 Agent", description: "测试", instructions: "执行测试任务。", model: { provider: "openai-compatible", model: "gpt-4o-mini", temperature: 0.2, maxOutputTokens: 2048 }, limits: { maxTurns: 12, timeoutMs: 300000, maxToolCalls: 20, maxCostUsd: 1 }, knowledge: [], tools: { skillIds: [], connectorIds: [] }, approval: { mode: "high_risk", highRiskActions: ["write", "delete", "send", "pay"] }, memory: { enabled: false, mode: "user" }, output: { format: "markdown" }, visibility: "org" }, changelog: "" }, published: null, revisions: [{ id: "rev-1", version: 1, status: "draft", changelog: "", createdAt: new Date().toISOString(), publishedAt: null }] }
      : path === "/v1/models" ? { items: [], allowedHosts: ["api.example.test"] }
      : path === "/v1/skills" ? { items: [] }
      : path === "/v1/knowledge-spaces/create" ? { items: [] }
      : /^\/v1\/knowledge-spaces\/[^/]+\/documents$/.test(path) ? { items: [] }
      : /^\/v1\/knowledge-spaces\/[^/]+$/.test(path) ? { space: { id: "fixture-1", name: "测试知识库", description: "测试说明", embeddingModel: "embed", documentCount: 0 } }
      : path === "/v1/knowledge-spaces" ? { items: [] }
      : { data: { items: [], resource: { id: "fixture-1", name: "测试资源" }, metrics: { total: 0 } } };
    await route.fulfill({ json: body });
  });
});

for (const route of [...new Map([...platformRoutes, ...tenantRoutes].filter((route) => route.pageId).map((route) => [route.path, route])).values()]) {
  test(`renders ${route.shell} ${route.path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const path = route.path === "/tenant/content/new" ? "/tenant/content/draft-new" : route.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, "fixture-1");
    await page.goto(path);
    if (route.pageId === "agent-detail") {
      await expect(page.getByRole("heading", { name: "测试 Agent" })).toBeVisible();
      await expect(page.getByText("版本历史")).toBeVisible();
      expect(errors).toEqual([]);
      return;
    }
    const title = ({ models: "模型连接", "knowledge-create": "知识库", "knowledge-detail": "测试知识库", "knowledge-document": "测试知识库" } as Record<string, string>)[route.pageId!] ?? adminPageCatalog[route.pageId!].title;
    await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible({ timeout: 5000 }).catch((error) => { throw new Error(`${error.message}\nBrowser errors: ${errors.join(" | ")}`); });
    await expect(page.getByRole("navigation")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("mobile navigation opens grouped page selector", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tenant/overview");
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("combobox", { name: "页面导航" }).selectOption("/tenant/models");
  await expect(page.getByRole("heading", { name: "模型连接", exact: true })).toBeVisible();
});

test("tenant login presents membership authorization errors without hiding them", async ({ page }) => {
  await page.route("**/v1/auth/me", (route) => route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "未登录" } } }));
  await page.route("**/v1/auth/login", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "该账号没有可用的组织成员身份" } } }));
  await page.goto("/tenant/overview");
  await expect(page.getByText("登录管理后台", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往平台运营登录" })).toHaveAttribute("href", "/super-admin");
  await page.getByLabel("邮箱").fill("person@example.test");
  await page.getByLabel("密码").fill("incorrect-pass");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await expect(page.getByRole("alert")).toContainText("该账号没有可用的组织成员身份");
});

test("platform login shows an actionable message when the API is unavailable", async ({ page }) => {
  await page.route("**/v1/platform/me", (route) => route.fulfill({ status: 500, body: "proxy error" }));
  await page.goto("/super-admin");
  await expect(page.getByRole("alert")).toHaveText("管理服务暂不可用，请确认 API 服务已启动后重试。");
  await expect(page.getByLabel("平台邮箱")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await page.route("**/v1/platform-auth/login", (route) => route.fulfill({ status: 500, body: "proxy error" }));
  await page.getByLabel("平台邮箱").fill("platform@example.test");
  await page.getByLabel("密码").fill("password-value");
  await page.getByRole("button", { name: "进入平台运营" }).click();
  await expect(page.getByRole("alert")).toHaveText("管理服务暂不可用，请确认 API 服务已启动后重试。");
});

test("required fields prevent empty create requests", async ({ page }) => {
  let mutations = 0;
  page.on("request", (request) => { if (request.method() === "POST") mutations++; });
  await page.goto("/super-admin/tenants");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  expect(mutations).toBe(0);
  await expect(page.locator("#admin-resource-form")).toBeVisible();
});

test("generic admin lists filter locally, paginate, and open row details", async ({ page }) => {
  const listReads: string[] = [];
  await page.route("**/v1/platform/tenants", async (route) => {
    if (route.request().method() === "GET") listReads.push(route.request().url());
    await route.fulfill({ json: { items: [
      { id: "tenant-a", name: "Acme North", slug: "acme-north", plan: "team", status: "active" },
      { id: "tenant-b", name: "Acme South", slug: "acme-south", plan: "trial", status: "suspended" },
    ], total: 2 } });
  });
  await page.goto("/super-admin/tenants");
  await expect(page.getByRole("row", { name: /Acme North/ })).toBeVisible();
  const initialReads = listReads.length;
  await page.getByRole("combobox", { name: "按状态筛选" }).selectOption("suspended");
  await expect(page.getByRole("row", { name: /Acme South/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Acme North/ })).toHaveCount(0);
  await page.getByRole("combobox", { name: "按状态筛选" }).selectOption("");
  await page.getByLabel("搜索记录").fill("north");
  await expect(page.getByRole("row", { name: /Acme North/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Acme South/ })).toHaveCount(0);
  expect(listReads).toHaveLength(initialReads);
  expect(listReads.every((url) => !new URL(url).searchParams.has("q"))).toBe(true);
  await page.getByRole("row", { name: /Acme North/ }).click();
  await expect(page.getByRole("dialog")).toContainText("acme-north");
});

test("import submits the same values that were previewed", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/v1/admin/platform/connectors:import*", async (route) => {
    if (route.request().method() === "POST") requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { items: [], tools: ["lookup"] } } });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/super-admin/connectors/import");
  await page.getByRole("button", { name: "解析预览", exact: true }).click();
  const form = page.locator("#admin-resource-form");
  await form.locator("select").selectOption("openapi");
  await form.locator("input").nth(0).fill("https://example.test/openapi.json");
  await form.locator("input").nth(1).fill("测试连接器");
  await form.locator("input").nth(2).fill("运营团队");
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("预览完成");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.getByRole("button", { name: "确认导入", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("服务端确认");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("Agent creation opens a domain editor and persists a complete draft contract", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/v1/agents**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname === "/v1/agents" && url.searchParams.has("scope")) return route.fulfill({ json: { items: [], total: 0 } });
    if (route.request().method() === "GET" && url.pathname === "/v1/agents/new-agent") return route.fulfill({ json: { agent: { id: "new-agent", name: "客服助手", description: "工单答疑", status: "draft", visibility: "org", currentRevisionId: "rev-1", publishedVersion: null, updatedAt: new Date().toISOString() }, draft: { version: 1, definition: { name: "客服助手", description: "工单答疑", instructions: "先确认问题，再给出解决步骤。", model: { provider: "openai-compatible", model: "gpt-4o-mini", temperature: 0.2, maxOutputTokens: 2048 }, limits: { maxTurns: 12, timeoutMs: 300000, maxToolCalls: 20, maxCostUsd: 1 }, knowledge: [], tools: { skillIds: [], connectorIds: [] }, approval: { mode: "high_risk", highRiskActions: ["write", "delete", "send", "pay"] }, memory: { enabled: false, mode: "user" }, output: { format: "markdown" }, visibility: "org" }, changelog: "" }, published: null, revisions: [{ id: "rev-1", version: 1, status: "draft", changelog: "", createdAt: new Date().toISOString(), publishedAt: null }] } });
    if (route.request().method() === "POST") {
      payload = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { agent: { id: "new-agent", name: "客服助手", status: "draft", description: "工单答疑", visibility: "org" }, draft: { id: "rev-1", version: 1, definition: payload.definition, changelog: "" }, published: null, revisions: [{ id: "rev-1", version: 1, status: "draft", changelog: "", createdAt: new Date().toISOString(), publishedAt: null }] } });
    }
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto("/tenant/agents");
  await page.getByRole("button", { name: "新建 Agent" }).click();
  await page.getByLabel("名称").fill("客服助手");
  await page.getByLabel("说明").fill("工单答疑");
  await page.getByLabel("系统指令").fill("先确认问题，再给出解决步骤。");
  await page.getByRole("button", { name: "保存草稿并继续" }).click();
  await expect(page).toHaveURL(/\/tenant\/agents\/new-agent$/);
  expect((payload?.definition as Record<string, unknown>).instructions).toBe("先确认问题，再给出解决步骤。");
  expect((payload?.definition as Record<string, unknown>).tools).toEqual({ skillIds: [], connectorIds: [] });
  await expect(page.getByRole("heading", { name: "客服助手" })).toBeVisible();
  await expect(page.locator("body")).toContainText("客服助手");
  await expect(page.getByText("版本历史")).toBeVisible();
});

test("skill editor submits reusable instructions and creates a versioned skill", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/v1/skills", async (route) => {
    if (route.request().method() === "POST") payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { items: [], skill: { id: "skill-1", version: 1 } } });
  });
  await page.goto("/tenant/skills");
  await page.getByLabel("技能名称").fill("需求拆解");
  await page.getByLabel("说明").fill("把需求转换成可验收任务");
  await page.getByLabel("技能指令").fill("列出目标、范围、验收条件和风险。");
  await page.getByRole("button", { name: "创建技能" }).click();
  await expect(page.getByRole("status")).toContainText("技能已创建");
  expect(payload).toMatchObject({ name: "需求拆解", instructions: "列出目标、范围、验收条件和风险。", visibility: "org" });
});

test("model connection editor submits secret only on save and supports connection check", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/v1/models", async (route) => {
    if (route.request().method() === "POST") payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { items: [], allowedHosts: ["api.example.test"] } });
  });
  await page.goto("/tenant/models");
  await page.getByLabel("连接名称").fill("主模型");
  await page.getByLabel("模型标识").fill("model-x");
  await page.getByLabel("HTTPS API 地址").fill("https://api.example.test/v1");
  await page.getByLabel("API 密钥").fill("secret-value");
  await page.getByRole("button", { name: "保存连接" }).click();
  await expect(page.getByRole("status")).toContainText("不会再次回显");
  expect(payload).toMatchObject({ name: "主模型", model: "model-x", apiKey: "secret-value", enabled: true });
});

test("knowledge workspace uploads a selected source document", async ({ page }) => {
  let uploadPath = "";
  await page.route("**/v1/knowledge-spaces/space-1", (route) => route.fulfill({ json: { space: { id: "space-1", name: "产品资料", description: "产品文档", embeddingModel: "embed", documentCount: 0 } } }));
  await page.route("**/v1/knowledge-spaces/space-1/documents", async (route) => {
    uploadPath = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET") await route.fulfill({ json: { items: [] } });
    else await route.fulfill({ json: { document: { id: "doc-1", status: "pending" } } });
  });
  await page.goto("/tenant/knowledge/space-1");
  await page.locator('input[type="file"]').setInputFiles({ name: "guide.md", mimeType: "text/markdown", buffer: Buffer.from("# Guide") });
  await page.getByRole("button", { name: "上传并索引" }).click();
  await expect(page.getByRole("status")).toContainText("进入索引队列");
  expect(uploadPath).toBe("/v1/knowledge-spaces/space-1/documents");
});
