import { AppError } from "./errors.js";
import type { RuntimeBootstrapSnapshot } from "@workagent/contracts";
import { buildKnowledgePrompt, retrieve } from "./knowledge.js";
import { chatCompletion, estimateCostUsd, toToolDefinitions } from "./model.js";
import { executeTool } from "./tools.js";
import type { ChatMessage } from "./model.js";

export type PreviewResult = {
  output: string;
  toolCalls: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
};

export async function previewAgent(input: {
  bootstrap: RuntimeBootstrapSnapshot;
  message: string;
  orgId: string;
  userId: string;
  agentId: string;
}): Promise<PreviewResult> {
  const { bootstrap } = input;
  const messages: ChatMessage[] = [
    { role: "system", content: bootstrap.systemPrompt },
  ];

  const spaceIds = bootstrap.definition.knowledge
    .map((item) => item.spaceId)
    .filter(Boolean);
  if (spaceIds.length > 0) {
    const chunks = [];
    for (const ref of bootstrap.definition.knowledge) {
      if (!ref.spaceId) continue;
      chunks.push(
        ...(await retrieve(
          [ref.spaceId],
          input.message,
          ref.topK,
          ref.minScore,
          input.orgId,
        )),
      );
    }
    const unique = Array.from(
      new Map(chunks.map((chunk) => [chunk.chunkId, chunk])).values(),
    );
    if (unique.length > 0) {
      messages.push({ role: "system", content: buildKnowledgePrompt(unique) });
    }
  }

  messages.push({ role: "user", content: input.message });
  const toolDefs = toToolDefinitions(bootstrap.toolPlan);
  const toolCalls: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let turns = 0;

  for (;;) {
    if (turns >= Math.min(bootstrap.definition.limits.maxTurns, 6)) {
      return {
        output: "预览达到最大轮次，未生成最终回答。",
        toolCalls,
        inputTokens,
        outputTokens,
        costUsd,
        turns,
      };
    }
    const result = await chatCompletion({
      definition: bootstrap.definition,
      messages,
      tools: toolDefs,
    });
    turns += 1;
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    costUsd += estimateCostUsd(
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.model,
    );

    if (result.toolCalls.length === 0) {
      return {
        output: result.content.trim(),
        toolCalls,
        inputTokens,
        outputTokens,
        costUsd,
        turns,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });
    for (const call of result.toolCalls) {
      toolCalls.push(call.function.name);
      const tool = bootstrap.toolPlan.tools.find(
        (item) => item.name === call.function.name,
      );
      if (!tool) {
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: `未知工具: ${call.function.name}` }),
          tool_call_id: call.id,
          name: call.function.name,
        });
        continue;
      }
      if (
        tool.source === "mcp" ||
        !["GET", "HEAD", "OPTIONS"].includes(
          String(tool.config.method ?? "POST").toUpperCase(),
        ) ||
        tool.approvalRequired ||
        tool.risk !== "low" ||
        bootstrap.definition.approval.mode === "always"
      ) {
        messages.push({
          role: "tool",
          content: JSON.stringify({
            error: "Preview cannot bypass approval; publish and create a run",
          }),
          tool_call_id: call.id,
          name: tool.name,
        });
        continue;
      }
      const args = parseArgs(call.function.arguments);
      try {
        const toolResult = await executeTool(tool, args, {
          orgId: input.orgId,
          agentId: input.agentId,
          runId: "preview",
          userId: input.userId,
        });
        messages.push({
          role: "tool",
          content:
            typeof toolResult.output === "string"
              ? toolResult.output
              : JSON.stringify(toolResult.output),
          tool_call_id: call.id,
          name: tool.name,
        });
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : "Preview execution failed; details redacted";
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: message }),
          tool_call_id: call.id,
          name: tool.name,
        });
      }
    }
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}
