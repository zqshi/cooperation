import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRequest, resolveAdminEndpoint } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

describe("admin API adapter", () => {
  it("encodes identifiers while resolving contract route parameters", () => {
    expect(resolveAdminEndpoint("/v1/admin/tenants/:tenantId/users/:userId", { tenantId: "tenant/a", userId: "user 1" }))
      .toBe("/v1/admin/tenants/tenant%2Fa/users/user%201");
  });

  it("preserves command suffixes while resolving resource identifiers", () => {
    expect(resolveAdminEndpoint("/v1/admin/connectors:import-preview", {})).toBe("/v1/admin/connectors:import-preview");
    expect(resolveAdminEndpoint("/v1/admin/tenant/agents/:id", { id: "a" })).toBe("/v1/agents/a");
    expect(resolveAdminEndpoint("/v1/admin/platform/dictionaries", {})).toBe("/v1/platform/dicts");
    expect(resolveAdminEndpoint("/v1/admin/connectors/:id:publish", { id: "a/b" })).toBe("/v1/admin/connectors/a%2Fb:publish");
  });

  it("resolves parameters embedded in query strings", () => {
    expect(resolveAdminEndpoint("/v1/platform/scheduled-runs/date/:date", { date: "2026-11-06" }))
      .toBe("/v1/platform/scheduled-runs/date/2026-11-06");
  });

  it("rejects an unresolved route parameter", () => {
    expect(() => resolveAdminEndpoint("/v1/admin/runs/:runId", {})).toThrow("缺少路由参数：runId");
  });

  it("sends scoped cookie requests and JSON command payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "r-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adminRequest("/v1/admin/tenant/agents", { method: "POST", body: { name: "Agent A" } }))
      .resolves.toEqual({ data: { id: "r-1" } });
    expect(fetchMock).toHaveBeenCalledWith("/v1/admin/tenant/agents", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Agent A" }),
    }));
  });

  it("preserves safe API error codes and trace identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "STALE_VERSION", message: "请刷新后重试", traceId: "trace-1" } }), { status: 409 })));
    await expect(adminRequest("/v1/admin/tenant/content/c-1", { method: "PATCH", body: {} }))
      .rejects.toMatchObject({ status: 409, code: "STALE_VERSION", traceId: "trace-1", message: "请刷新后重试" });
  });

  it("explains when the API service behind the console is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("proxy error", { status: 500 })));
    await expect(adminRequest("/v1/platform-auth/login", { method: "POST", body: { email: "a@example.test", password: "password" } }))
      .rejects.toMatchObject({ status: 500, message: "管理服务暂不可用，请确认 API 服务已启动后重试。" });
  });
});
