import crypto from "node:crypto";
import { config } from "@workagent/config";
import type { AgentDefinition, ToolPlanItem } from "@workagent/contracts";
import { AppError } from "./errors.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  mock: boolean;
};

type OpenAiResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function toToolDefinitions(toolPlan: {
  tools: ToolPlanItem[];
}): ToolDefinition[] {
  return toolPlan.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export async function chatCompletion(input: {
  definition: AgentDefinition;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}): Promise<ChatResult> {
  if (config.useMockModel) {
    return mockChat(input);
  }

  if (!config.modelApiKey)
    throw new AppError(503, "model_unconfigured", "Model credentials required");
  const body: Record<string, unknown> = {
    model: input.definition.model.model,
    messages: input.messages,
    temperature: input.definition.model.temperature,
    max_tokens: input.definition.model.maxOutputTokens,
  };
  if (input.tools.length > 0) {
    body.tools = input.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(
    `${config.modelBaseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.modelApiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal ?? AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      502,
      "model_error",
      `模型调用失败 (${response.status}): [provider details redacted]`,
    );
  }

  const data = (await boundedJson(response)) as OpenAiResponse;
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) throw new AppError(502, "model_error", "模型返回为空");

  if (
    message.content !== null &&
    message.content !== undefined &&
    typeof message.content !== "string"
  )
    throw new AppError(502, "model_error", "Invalid model content");
  if (
    !Array.isArray(message.tool_calls ?? []) ||
    (message.tool_calls?.length ?? 0) > 32
  )
    throw new AppError(502, "model_error", "Invalid tool calls");
  const ids = new Set<string>();
  for (const call of message.tool_calls ?? []) {
    if (
      !call ||
      typeof call.id !== "string" ||
      !call.id ||
      call.id.length > 200 ||
      ids.has(call.id) ||
      call.type !== "function" ||
      typeof call.function?.name !== "string" ||
      !input.tools.some((t) => t.function.name === call.function.name) ||
      typeof call.function.arguments !== "string" ||
      call.function.arguments.length > 65536
    )
      throw new AppError(502, "model_error", "Invalid model tool call");
    try {
      const args = JSON.parse(call.function.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new Error();
    } catch {
      throw new AppError(502, "model_error", "Invalid tool arguments");
    }
    ids.add(call.id);
  }
  for (const n of [
    data.usage?.prompt_tokens ?? 0,
    data.usage?.completion_tokens ?? 0,
  ])
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000000)
      throw new AppError(502, "model_error", "Invalid model usage");
  return {
    content: message.content ?? "",
    toolCalls: (message.tool_calls ?? []).map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.function.name,
        arguments: call.function.arguments,
      },
    })),
    finishReason: choice?.finish_reason ?? "stop",
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    model: input.definition.model.model,
    mock: false,
  };
}

function mockChat(input: {
  definition: AgentDefinition;
  messages: ChatMessage[];
  tools: ToolDefinition[];
}): ChatResult {
  const toolNames = new Set(input.tools.map((tool) => tool.function.name));
  const last = [...input.messages]
    .reverse()
    .find((message) => message.role !== "system");
  const lastUser = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  const toolResults = input.messages.filter(
    (message) => message.role === "tool",
  );
  const lastTool = toolResults.at(-1);
  const userText = lastUser?.content ?? "";
  const knowledge = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  const usage = (text: string) => ({
    inputTokens: Math.max(
      1,
      Math.ceil(input.messages.map((m) => m.content).join(" ").length / 4),
    ),
    outputTokens: Math.max(1, Math.ceil(text.length / 4)),
  });

  if (lastTool) {
    const content = summarizeToolResult(
      lastTool.name ?? "tool",
      lastTool.content,
    );
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: usage(content),
      model: "mock",
      mock: true,
    };
  }

  if (toolNames.has("lookup_order") && /订单|order/i.test(userText)) {
    const orderId = extractOrderId(userText);
    if (orderId) {
      const callId = `call_${crypto.randomUUID().slice(0, 12)}`;
      return {
        content: "",
        toolCalls: [
          {
            id: callId,
            type: "function",
            function: {
              name: "lookup_order",
              arguments: JSON.stringify({ orderId }),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: usage(""),
        model: "mock",
        mock: true,
      };
    }
  }

  if (/退款|赔付|退货|refund/i.test(userText)) {
    const content = [
      "退款/赔付需要结合订单状态、购买时间和合同条款判断，我不能直接承诺结果。",
      "建议先确认订单号和客户诉求，再提交人工复核。",
      knowledge.includes("【知识库检索结果】")
        ? "\n已检索到相关知识条目，请以引用内容为准。"
        : "",
    ].join("\n");
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: usage(content),
      model: "mock",
      mock: true,
    };
  }

  if (/订单|物流|发货/.test(userText)) {
    const content =
      "请提供订单号，我可以帮你查询订单状态、金额和物流信息。订单号通常以字母开头，例如 A20260101。";
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: usage(content),
      model: "mock",
      mock: true,
    };
  }

  const content = [
    `收到：${userText.slice(0, 200)}`,
    "",
    "当前为本地演示模式（未配置模型 API Key）。我可以继续执行工具调用、知识检索、审批和产物流程；配置 MODEL_API_KEY 后会切换为真实模型。",
    knowledge.includes("【知识库检索结果】")
      ? "\n本次回答已参考知识库检索结果。"
      : "",
  ].join("\n");

  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    usage: usage(content),
    model: "mock",
    mock: true,
  };
}

function summarizeToolResult(name: string, raw: string): string {
  if (name === "lookup_order") {
    try {
      const data = JSON.parse(raw) as {
        orderId?: string;
        status?: string;
        amount?: number;
        logistics?: string;
      };
      return [
        `订单 ${data.orderId ?? ""} 的当前状态：${data.status ?? "未知"}。`,
        data.amount !== undefined ? `订单金额：${data.amount} 元。` : "",
        data.logistics ? `物流信息：${data.logistics}` : "",
        "",
        "如需退款、赔付或修改订单，请转人工确认。",
      ]
        .filter(Boolean)
        .join("\n");
    } catch {
      return `订单查询结果：${raw.slice(0, 500)}`;
    }
  }
  return `工具 ${name} 返回：${raw.slice(0, 800)}`;
}

export function extractOrderId(text: string): string | null {
  const labeled = text.match(/订单号?\s*[:：]?\s*([A-Za-z]{1,6}[-]?\d{4,})/);
  if (labeled?.[1]) return labeled[1];
  const generic = text.match(/\b([A-Za-z]{1,6}\d{5,})\b/);
  return generic?.[1] ?? null;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (config.useMockModel) {
    return texts.map((text) => mockEmbedding(text, config.embeddingDim));
  }

  const response = await fetch(
    `${config.modelBaseUrl.replace(/\/$/, "")}/embeddings`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.modelApiKey}`,
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: texts,
        dimensions: config.embeddingDim,
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      502,
      "embedding_error",
      `向量化失败 (${response.status}): [provider details redacted]`,
    );
  }
  const data = (await boundedJson(response)) as {
    data?: Array<{ embedding: number[]; index: number }>;
  };
  const entries = data.data ?? [];
  if (
    !Array.isArray(entries) ||
    entries.some(
      (x) =>
        !Number.isInteger(x.index) || x.index < 0 || x.index >= texts.length,
    ) ||
    new Set(entries.map((x) => x.index)).size !== texts.length
  )
    throw new AppError(502, "embedding_error", "Invalid embedding indexes");
  const vectors = entries
    .sort((a, b) => a.index - b.index)
    .map((x) => x.embedding);
  if (vectors.length !== texts.length) {
    throw new AppError(502, "embedding_error", "向量数量与输入不一致");
  }
  if (
    vectors.some(
      (v) =>
        !Array.isArray(v) ||
        v.length !== config.embeddingDim ||
        v.some((n) => typeof n !== "number" || !Number.isFinite(n)),
    )
  )
    throw new AppError(
      502,
      "embedding_error",
      "Embedding dimension or value invalid",
    );
  return vectors;
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(502, "model_error", "Missing provider response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024)
        throw new AppError(
          502,
          "model_error",
          "Provider response exceeds limit",
        );
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new AppError(502, "model_error", "Invalid provider JSON");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function mockEmbedding(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const hash = crypto.createHash("sha256").update(token).digest();
    const index = hash.readUInt32BE(0) % dim;
    const sign = hash[4]! % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const norm =
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}]+/gu) ?? [];
  const cjk = lower.match(/[\u4e00-\u9fff]/g) ?? [];
  const bigrams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i += 1) {
    bigrams.push(`${cjk[i]}${cjk[i + 1]}`);
  }
  return [...words, ...cjk, ...bigrams];
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "deepseek-chat": { input: 0.27, output: 1.1 },
    mock: { input: 0.15, output: 0.6 },
  };
  const price = pricing[model] ?? { input: 1, output: 3 };
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value.toFixed(6))).join(",")}]`;
}
