export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function resolveAdminEndpoint(
  endpoint: string,
  params: Record<string, string | undefined>,
): string {
  const resolved = endpoint.replace(/(?<=[/?&]):([A-Za-z][A-Za-z0-9]*)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`缺少路由参数：${key}`);
    return encodeURIComponent(value);
  });
  const aliases: Array<[string, string]> = [
    ["/v1/admin/platform/dictionaries", "/v1/platform/dicts"],
    ["/v1/admin/platform/", "/v1/platform/"],
    ["/v1/admin/tenant/agents", "/v1/agents"],
    ["/v1/admin/tenant/skills", "/v1/skills"],
    ["/v1/admin/tenant/models", "/v1/models"],
    ["/v1/admin/tenant/knowledge-spaces", "/v1/knowledge-spaces"],
    ["/v1/admin/tenant/connectors", "/v1/connectors"],
    ["/v1/admin/tenant/channels", "/v1/channels"],
    ["/v1/admin/tenant/content", "/v1/management/content"],
    ["/v1/admin/tenant/users", "/v1/members"],
    ["/v1/admin/tenant/overview", "/v1/tenant-home"],
    ["/v1/admin/tenant/audit-log", "/v1/audit"],
  ];
  let mapped = resolved;
  for (const [from, to] of aliases) if (!mapped.includes("connectors:import") && mapped.startsWith(from)) {
    mapped = to + mapped.slice(from.length);
    break;
  }
  return mapped === resolved ? mapped : mapped.replace(/:([a-z-]+)$/, "/$1");
}

export async function adminRequest<T>(
  endpoint: string,
  options: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AdminApiError("无法连接管理服务，请检查服务状态后重试。", 0);
  }

  const payload = await response.json().catch(() => null) as {
    error?: { code?: string; message?: string; traceId?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    throw new AdminApiError(
      payload?.error?.message ?? payload?.message ?? (response.status >= 500
        ? "管理服务暂不可用，请确认 API 服务已启动后重试。"
        : `请求失败（${response.status}）`),
      response.status,
      payload?.error?.code,
      payload?.error?.traceId,
    );
  }
  return payload as T;
}
