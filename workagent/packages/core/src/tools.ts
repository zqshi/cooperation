import { assertSchema } from "./json-schema.js";
import { toolFetch } from "./network.js";
import { one, query } from "@workagent/db";
import type { ToolPlanItem } from "@workagent/contracts";
import { decryptSecret, stableChecksum } from "./crypto.js";
import { AppError, badRequest } from "./errors.js";

export type ToolContext = {
  orgId: string;
  agentId: string;
  runId: string;
  userId: string;
  invocationId?: string;
  signal?: AbortSignal;
};

export type ToolResult = {
  output: unknown;
  latencyMs: number;
  status: number;
};

type ConnectorSecretRow = {
  id: string;
  base_url: string | null;
  mcp_url: string | null;
  auth_type: string;
  secret_encrypted: string | null;
};

export async function executeTool(
  tool: ToolPlanItem,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  validateInput(tool.inputSchema, args);
  ctx.signal?.throwIfAborted();
  if (!ctx.invocationId) return executeToolRequest(tool, args, ctx);
  const hash = stableChecksum({
    orgId: ctx.orgId,
    runId: ctx.runId,
    tool,
    args,
  });
  const inserted = await query(
    "INSERT INTO tool_invocation(org_id,run_id,call_id,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING call_id",
    [ctx.orgId, ctx.runId, ctx.invocationId, hash],
  );
  if (!inserted.length) {
    const prior = await one<{
      status: string;
      request_hash: string;
      result: ToolResult;
    }>(
      "SELECT status,request_hash,result FROM tool_invocation WHERE org_id=$1 AND run_id=$2 AND call_id=$3",
      [ctx.orgId, ctx.runId, ctx.invocationId],
    );
    if (prior?.status === "succeeded" && prior.request_hash === hash)
      return prior.result;
    throw new AppError(
      409,
      "tool_outcome_unknown",
      "Prior tool outcome requires reconciliation before another attempt",
    );
  }
  try {
    const result = await executeToolRequest(tool, args, ctx);
    await query(
      "UPDATE tool_invocation SET status='succeeded',result=$4::jsonb,updated_at=now() WHERE org_id=$1 AND run_id=$2 AND call_id=$3",
      [ctx.orgId, ctx.runId, ctx.invocationId, JSON.stringify(result)],
    );
    return result;
  } catch (error) {
    await query(
      "UPDATE tool_invocation SET status='uncertain',updated_at=now() WHERE org_id=$1 AND run_id=$2 AND call_id=$3",
      [ctx.orgId, ctx.runId, ctx.invocationId],
    );
    throw new AppError(
      409,
      "tool_outcome_unknown",
      "Tool outcome requires manual reconciliation; workflow stopped",
    );
  }
}
async function executeToolRequest(
  tool: ToolPlanItem,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  validateInput(tool.inputSchema, args);
  const start = Date.now();

  if (tool.source === "http") {
    const result = await executeHttp(tool, args, ctx);
    return { ...result, latencyMs: Date.now() - start };
  }
  if (tool.source === "mcp") {
    const result = await executeMcp(tool, args, ctx);
    return { ...result, latencyMs: Date.now() - start };
  }
  throw badRequest(`不支持的工具来源: ${tool.source}`);
}

async function loadConnectorSecret(
  connectorId: string,
  orgId: string,
): Promise<ConnectorSecretRow | null> {
  return one<ConnectorSecretRow>(
    "SELECT id, base_url, mcp_url, auth_type, secret_encrypted FROM connector WHERE id = $1 AND org_id = $2 AND status = 'active'",
    [connectorId, orgId],
  );
}

function authHeaders(
  authType: string,
  encrypted: string | null,
): Record<string, string> {
  if (!encrypted || authType === "none") return {};
  const secret = decryptSecret(encrypted);
  if (authType === "bearer") return { authorization: `Bearer ${secret}` };
  if (authType === "api_key") return { "x-api-key": secret };
  if (authType === "basic") {
    return { authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
  }
  return {};
}

async function executeHttp(
  tool: ToolPlanItem,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ output: unknown; status: number }> {
  const connectorId = String(tool.config.connectorId ?? "");
  const baseUrl = String(tool.config.baseUrl ?? "");
  const method = String(tool.config.method ?? "POST").toUpperCase();
  const path = String(tool.config.path ?? "");
  const authType = String(tool.config.authType ?? "none");
  if (!baseUrl) throw badRequest(`工具 ${tool.name} 未配置 baseUrl`);

  const connector = connectorId
    ? await loadConnectorSecret(connectorId, ctx.orgId)
    : null;
  if (!connector) throw badRequest("Connector unavailable");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(ctx.invocationId
      ? {
          "idempotency-key": stableChecksum({
            runId: ctx.runId,
            callId: ctx.invocationId,
          }),
        }
      : {}),
    ...authHeaders(connector.auth_type, connector?.secret_encrypted ?? null),
  };

  if (connector.base_url !== baseUrl)
    throw badRequest("Connector endpoint changed; republish Agent");
  const remaining: Record<string, unknown> = { ...args };
  let resolvedPath = path.replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_match, key: string) => {
      const value = remaining[key];
      delete remaining[key];
      return encodeURIComponent(String(value ?? ""));
    },
  );

  let url = `${baseUrl.replace(/\/$/, "")}${resolvedPath.startsWith("/") ? "" : "/"}${resolvedPath}`;
  let body: string | undefined;

  if (method === "GET" || method === "DELETE") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(remaining)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const queryString = params.toString();
    if (queryString) url += `${url.includes("?") ? "&" : "?"}${queryString}`;
  } else {
    body = JSON.stringify(remaining);
  }

  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <=
    (["GET", "HEAD", "OPTIONS"].includes(method) ? tool.maxRetries : 0);
    attempt += 1
  ) {
    try {
      const response = await toolFetch(url, {
        method,
        headers,
        body,
        signal: ctx.signal
          ? AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeoutMs)])
          : AbortSignal.timeout(tool.timeoutMs),
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const output =
        contentType.includes("json") && text ? safeJsonParse(text) : text;
      if (!response.ok) {
        throw new AppError(
          502,
          "tool_error",
          `工具 ${tool.name} 返回 ${response.status}: [response body redacted]`,
        );
      }
      return { output, status: response.status };
    } catch (error) {
      lastError = error;
      if (error instanceof AppError) throw error;
      if (attempt < tool.maxRetries) {
        await sleep(300 * 2 ** attempt);
      }
    }
  }
  throw new AppError(
    502,
    "tool_error",
    `工具 ${tool.name} 调用失败: [details redacted]`,
  );
}

type McpContent = { type?: string; text?: string };
type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

async function executeMcp(
  tool: ToolPlanItem,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ output: unknown; status: number }> {
  const connectorId = String(tool.config.connectorId ?? "");
  const mcpUrl = String(tool.config.mcpUrl ?? "");
  const toolName = String(tool.config.toolName ?? tool.name);
  if (!mcpUrl) throw badRequest(`工具 ${tool.name} 未配置 mcpUrl`);

  const connector = connectorId
    ? await loadConnectorSecret(connectorId, ctx.orgId)
    : null;
  if (!connector) throw badRequest("Connector unavailable");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(ctx.invocationId
      ? {
          "idempotency-key": stableChecksum({
            runId: ctx.runId,
            callId: ctx.invocationId,
          }),
        }
      : {}),
    accept: "application/json, text/event-stream",
    ...authHeaders(
      connector?.auth_type ?? "none",
      connector?.secret_encrypted ?? null,
    ),
  };

  if (connector.mcp_url !== mcpUrl)
    throw badRequest("Connector endpoint changed; republish Agent");
  let sessionId = "";
  const initialize = await rpc(
    mcpUrl,
    headers,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "workagent", version: "0.1.0" },
      },
    },
    ctx.signal,
    tool.timeoutMs,
  );
  if (initialize.error)
    throw new AppError(502, "mcp_error", "MCP initialization failed");
  if (
    (initialize.result as { protocolVersion?: string })?.protocolVersion !==
    "2024-11-05"
  )
    throw new AppError(502, "mcp_error", "Unsupported MCP protocol");
  sessionId = initialize.sessionId;

  const versionHeaders = { ...headers, "mcp-protocol-version": "2024-11-05" };
  const withSession = sessionId
    ? { ...versionHeaders, "mcp-session-id": sessionId }
    : versionHeaders;
  const initialized = await toolFetch(mcpUrl, {
    method: "POST",
    headers: withSession,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal: ctx.signal
      ? AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeoutMs)])
      : AbortSignal.timeout(tool.timeoutMs),
  });

  if (!initialized.ok)
    throw new AppError(
      502,
      "mcp_error",
      "MCP initialized notification rejected",
    );
  const call = await rpc(
    mcpUrl,
    withSession,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    ctx.signal,
    tool.timeoutMs,
  );

  if (call.error) {
    throw new AppError(
      502,
      "mcp_error",
      `MCP 工具 ${toolName} 失败: [details redacted]`,
    );
  }
  const result = call.result as
    | { content?: McpContent[]; structuredContent?: unknown; isError?: boolean }
    | undefined;
  if (result?.isError) {
    const text =
      result.content?.map((item) => item.text ?? "").join("\n") ?? "unknown";
    throw new AppError(
      502,
      "mcp_error",
      `MCP 工具 ${toolName} 返回错误: [details redacted]`,
    );
  }
  if (result?.structuredContent !== undefined)
    return { output: result.structuredContent, status: 200 };
  if (Array.isArray(result?.content)) {
    const text = result.content.map((item) => item.text ?? "").join("\n");
    return { output: safeJsonParse(text), status: 200 };
  }
  return { output: result ?? null, status: 200 };
}

async function rpc(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<JsonRpcResponse & { sessionId: string }> {
  const response = await toolFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new AppError(502, "mcp_error", `MCP HTTP ${response.status}`);
  const sessionId = response.headers.get("mcp-session-id") ?? "";
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  const parsed = safeJsonParse(text) as JsonRpcResponse | null;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.jsonrpc !== "2.0" ||
    parsed.id !== payload.id ||
    "result" in parsed === "error" in parsed
  )
    throw new AppError(502, "mcp_error", "MCP 返回了非 JSON 响应");
  return { ...parsed, sessionId };
}

export function validateInput(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  assertSchema(schema, args);
}

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
