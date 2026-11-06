import { putObject } from "./storage.js";
import type {
  AgentDefinition,
  RunEvent,
  RuntimeBootstrapSnapshot,
  ToolPlanItem,
} from "@workagent/contracts";
import { one, query, pool, tx } from "@workagent/db";
import {
  appendMessage,
  getRunRecord,
  mapApproval,
  recordEvent,
  recordStep,
  updateRun,
} from "./runs.js";
import {
  chatCompletion,
  estimateCostUsd,
  toToolDefinitions,
  type ChatMessage,
  type ToolCall,
} from "./model.js";
import { buildKnowledgePrompt, retrieve } from "./knowledge.js";
import { executeTool } from "./tools.js";
import { AppError } from "./errors.js";
import { notifyChannelRun } from "./channel/index.js";

type RunRecord = Awaited<ReturnType<typeof getRunRecord>>;

type Checkpoint = {
  messages: ChatMessage[];
  turn: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  pendingToolCalls?: ToolCall[];
  pendingApprovalId?: string;
  finalAnswer?: string;
};

const TERMINAL = new Set(["succeeded", "failed", "canceled", "timeout"]);

export async function executeRun(runId: string, orgId: string): Promise<void> {
  const client = await pool.connect();
  const lease = new AbortController();
  let connectionLost = false;
  const lost = () => {
    connectionLost = true;
    lease.abort(
      new AppError(409, "tool_outcome_unknown", "Execution lease lost"),
    );
  };
  client.on("error", lost);
  const cancelTimer = setInterval(() => {
    void ensureNotCanceled(runId).catch((error) => lease.abort(error));
  }, 250);

  try {
    const lock = (
      await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,1)) AS locked",
        [runId],
      )
    ).rows[0]?.locked;
    if (!lock) throw new Error("Run execution already leased");
    await executeRunLocked(runId, orgId, lease.signal);
  } finally {
    try {
      clearInterval(cancelTimer);
      if (!connectionLost)
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,1))",
          [runId],
        );
    } finally {
      client.removeListener("error", lost);
      client.release(connectionLost);
    }
  }
}

async function executeRunLocked(
  runId: string,
  orgId: string,
  leaseSignal: AbortSignal,
): Promise<void> {
  const run = await getRunRecord(runId, orgId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (TERMINAL.has(run.status)) return;

  const bootstrap = run.revision_bootstrap;
  const checkpoint = normalizeCheckpoint(run.checkpoint);

  if (run.status === "waiting_approval") {
    const approval = await one<{ id: string; status: string }>(
      "SELECT id, status FROM approval WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1",
      [run.id],
    );
    if (!approval || approval.status === "pending") return;
    if (approval.status === "rejected") {
      await appendToolRejections(run, bootstrap, checkpoint, approval.id);
      checkpoint.pendingToolCalls = [];
      checkpoint.pendingApprovalId = undefined;
      await persistCheckpoint(run.id, checkpoint);
      await updateRun({ runId: run.id, status: "queued" });
    } else {
      await updateRun({ runId: run.id, status: "queued" });
    }
  }

  const current = await getRunRecord(runId, orgId);
  if (!current || TERMINAL.has(current.status)) return;

  if (!current.started_at) {
    await updateRun({ runId: run.id, status: "running", started: true });
    current.started_at = new Date().toISOString();
  } else {
    await updateRun({ runId: run.id, status: "running" });
  }

  try {
    leaseSignal.throwIfAborted();
    await ensureNotCanceled(runId);
    if (checkpoint.messages.length === 0) {
      await initializeCheckpoint(current, bootstrap, checkpoint);
    }
    await loop(current, bootstrap, checkpoint, leaseSignal);
  } catch (error) {
    if (error instanceof AppError && error.code === "run_canceled") return;
    await failRun(
      current,
      bootstrap,
      checkpoint,
      error instanceof Error && error.name === "TimeoutError"
        ? new AppError(408, "timeout", "Run deadline exceeded")
        : error,
    );
  }
}

function normalizeCheckpoint(raw: Record<string, unknown>): Checkpoint {
  return {
    messages: Array.isArray(raw.messages)
      ? (raw.messages as ChatMessage[])
      : [],
    turn: typeof raw.turn === "number" ? raw.turn : 0,
    toolCalls: typeof raw.toolCalls === "number" ? raw.toolCalls : 0,
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : 0,
    outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : 0,
    costUsd: typeof raw.costUsd === "number" ? raw.costUsd : 0,
    pendingToolCalls: Array.isArray(raw.pendingToolCalls)
      ? (raw.pendingToolCalls as ToolCall[])
      : undefined,
    pendingApprovalId:
      typeof raw.pendingApprovalId === "string"
        ? raw.pendingApprovalId
        : undefined,
    finalAnswer:
      typeof raw.finalAnswer === "string" ? raw.finalAnswer : undefined,
  };
}

async function initializeCheckpoint(
  run: NonNullable<RunRecord>,
  bootstrap: RuntimeBootstrapSnapshot,
  checkpoint: Checkpoint,
): Promise<void> {
  checkpoint.messages.push({ role: "system", content: bootstrap.systemPrompt });
  checkpoint.turn = 0;
  checkpoint.toolCalls = 0;

  if (bootstrap.definition.memory.enabled) {
    const memories = await query<{ key: string; value: string }>(
      `SELECT key, value FROM memory
        WHERE org_id = $1
          AND (user_id = $2 OR user_id IS NULL)
          AND (agent_id = $3 OR agent_id IS NULL)
        ORDER BY updated_at DESC LIMIT 20`,
      [run.org_id, run.user_id, run.agent_id],
    );
    if (memories.length > 0) {
      checkpoint.messages.push({
        role: "system",
        content: `【长期记忆】\n${memories.map((item) => `- ${item.key}: ${item.value}`).join("\n")}`,
      });
    }
  }

  const spaceIds = bootstrap.definition.knowledge
    .map((item) => item.spaceId)
    .filter(Boolean);
  if (spaceIds.length > 0) {
    const allChunks = [];
    for (const ref of bootstrap.definition.knowledge) {
      if (!ref.spaceId) continue;
      const chunks = await retrieve(
        [ref.spaceId],
        run.input,
        ref.topK,
        ref.minScore,
        run.org_id,
      );
      allChunks.push(...chunks);
    }
    const unique = Array.from(
      new Map(allChunks.map((chunk) => [chunk.chunkId, chunk])).values(),
    );
    if (unique.length > 0) {
      const content = buildKnowledgePrompt(unique);
      checkpoint.messages.push({ role: "system", content });
      await recordStep({
        runId: run.id,
        kind: "knowledge",
        name: "知识检索",
        status: "succeeded",
        input: { query: run.input, spaces: spaceIds },
        output: unique.map((chunk) => ({
          documentName: chunk.documentName,
          score: Number(chunk.score.toFixed(3)),
          preview: chunk.content.slice(0, 160),
        })),
      });
    }
  }

  checkpoint.messages.push({ role: "user", content: run.input });
  await persistCheckpoint(run.id, checkpoint);
}

async function loop(
  run: NonNullable<RunRecord>,
  bootstrap: RuntimeBootstrapSnapshot,
  checkpoint: Checkpoint,
  leaseSignal: AbortSignal,
): Promise<void> {
  const definition = bootstrap.definition;
  const toolDefs = toToolDefinitions(bootstrap.toolPlan);

  for (;;) {
    leaseSignal.throwIfAborted();
    await ensureNotCanceled(run.id);
    await ensureLimits(run, definition, checkpoint);

    if (checkpoint.pendingToolCalls && checkpoint.pendingToolCalls.length > 0) {
      const paused = await handlePendingToolCalls(
        run,
        bootstrap,
        checkpoint,
        leaseSignal,
      );
      if (paused) return;
      continue;
    }

    if (checkpoint.turn >= definition.limits.maxTurns) {
      throw new AppError(
        422,
        "max_turns",
        `超过最大轮次 ${definition.limits.maxTurns}`,
      );
    }

    const result = await chatCompletion({
      orgId: run.org_id,
      definition,
      messages: checkpoint.messages,
      tools: toolDefs,
      signal: AbortSignal.any([
        leaseSignal,
        AbortSignal.timeout(
          Math.max(
            1,
            definition.limits.timeoutMs -
              (Date.now() - new Date(run.started_at!).getTime()),
          ),
        ),
      ]),
    });

    checkpoint.turn += 1;
    checkpoint.inputTokens += result.usage.inputTokens;
    checkpoint.outputTokens += result.usage.outputTokens;
    checkpoint.costUsd += estimateCostUsd(
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.model,
    );

    await updateRun({
      runId: run.id,
      turns: checkpoint.turn,
      inputTokens: checkpoint.inputTokens,
      outputTokens: checkpoint.outputTokens,
      costUsd: checkpoint.costUsd,
    });

    if (result.toolCalls.length > 0) {
      checkpoint.messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });
      checkpoint.pendingToolCalls = result.toolCalls;
      await persistCheckpoint(run.id, checkpoint);
      continue;
    }

    leaseSignal.throwIfAborted();
    await ensureNotCanceled(run.id);
    await ensureLimits(run, definition, checkpoint);
    const output = result.content.trim();
    checkpoint.finalAnswer = output;
    checkpoint.messages.push({ role: "assistant", content: output });
    const finalized = await tx(async (c) => {
      const changed = await c.query(
        "UPDATE agent_run SET status='succeeded',output=$2,turns=$3,tool_calls=$4,input_tokens=$5,output_tokens=$6,cost_usd=$7,checkpoint=$8::jsonb,finished_at=now() WHERE id=$1 AND status='running' RETURNING id",
        [
          run.id,
          output,
          checkpoint.turn,
          checkpoint.toolCalls,
          checkpoint.inputTokens,
          checkpoint.outputTokens,
          checkpoint.costUsd,
          JSON.stringify(checkpoint),
        ],
      );
      if (!changed.rowCount) return false;
      await c.query(
        "INSERT INTO message(conversation_id,run_id,role,content) VALUES($1,$2,'assistant',$3)",
        [run.conversation_id, run.id, output],
      );
      return true;
    });
    if (!finalized) return;
    const key = `${run.org_id}/runs/${run.id}/result.md`;
    const bytes = Buffer.from(output);
    await putObject(key, bytes, "text/markdown");
    await query(
      "INSERT INTO artifact(run_id,name,mime_type,size,storage_key) VALUES($1,'result.md','text/markdown',$2,$3) ON CONFLICT(run_id,name) DO NOTHING",
      [run.id, bytes.length, key],
    );
    await emit(run.id, {
      type: "message.completed",
      runId: run.id,
      messageId: run.id,
      content: output,
    });
    await emit(run.id, {
      type: "run.completed",
      runId: run.id,
      status: "succeeded",
      output,
    });
    await recordUsage(run, bootstrap, checkpoint);
    await notifyQuietly(run.id, "result");
    return;
  }
}

async function handlePendingToolCalls(
  run: NonNullable<RunRecord>,
  bootstrap: RuntimeBootstrapSnapshot,
  checkpoint: Checkpoint,
  leaseSignal: AbortSignal,
): Promise<boolean> {
  const pending = checkpoint.pendingToolCalls ?? [];

  const requiring = pending.filter((call) => {
    const tool = findTool(bootstrap, call.function.name);
    return tool ? requiresApproval(tool, bootstrap.definition) : false;
  });

  if (requiring.length > 0 && !checkpoint.pendingApprovalId) {
    const approval = await createApproval(run, bootstrap, requiring);
    checkpoint.pendingApprovalId = approval.id;
    await persistCheckpoint(run.id, checkpoint);
    await updateRun({ runId: run.id, status: "waiting_approval" });
    await appendMessage({
      conversationId: run.conversation_id,
      runId: run.id,
      role: "system",
      content: `等待人工审批：${requiring.map((call) => call.function.name).join(", ")}`,
    });
    await emit(run.id, { type: "approval.required", runId: run.id, approval });
    await notifyQuietly(run.id, "approval");
    return true;
  }

  for (const call of pending) {
    leaseSignal.throwIfAborted();
    await ensureNotCanceled(run.id);
    await ensureLimits(run, bootstrap.definition, checkpoint);
    const tool = findTool(bootstrap, call.function.name);
    if (!tool) {
      const error = `未知工具: ${call.function.name}`;
      await appendToolResult(run, checkpoint, call, { error });
      checkpoint.messages.push({
        role: "tool",
        content: JSON.stringify({ error }),
        tool_call_id: call.id,
        name: call.function.name,
      });
      await recordStep({
        runId: run.id,
        kind: "tool",
        name: call.function.name,
        status: "failed",
        input: safeJson(call.function.arguments),
        error: "未知工具",
      });
      continue;
    }

    if (
      requiresApproval(tool, bootstrap.definition) &&
      checkpoint.pendingApprovalId
    ) {
      const approval = await one<{ status: string }>(
        "SELECT status FROM approval WHERE id = $1",
        [checkpoint.pendingApprovalId],
      );
      if (approval?.status === "rejected") {
        const error = "人工审批拒绝执行该工具";
        await appendToolResult(run, checkpoint, call, { error });
        checkpoint.messages.push({
          role: "tool",
          content: JSON.stringify({ error }),
          tool_call_id: call.id,
          name: tool.name,
        });
        await recordStep({
          runId: run.id,
          kind: "approval",
          name: tool.name,
          status: "failed",
          input: safeJson(call.function.arguments),
          error: "人工审批拒绝",
        });
        continue;
      }
    }

    if (checkpoint.toolCalls >= bootstrap.definition.limits.maxToolCalls)
      throw new AppError(422, "max_tool_calls", "Tool call limit reached");
    const args = safeJsonObject(call.function.arguments);
    try {
      const result = await executeTool(tool, args, {
        orgId: run.org_id,
        agentId: run.agent_id,
        runId: run.id,
        userId: run.user_id,
        invocationId: call.id,
        signal: AbortSignal.any([
          leaseSignal,
          AbortSignal.timeout(
            Math.max(
              1,
              bootstrap.definition.limits.timeoutMs -
                (Date.now() - new Date(run.started_at!).getTime()),
            ),
          ),
        ]),
      });
      await ensureNotCanceled(run.id);
      const content =
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output);
      await appendToolResult(run, checkpoint, call, result.output);
      await recordStep({
        runId: run.id,
        kind: "tool",
        name: tool.name,
        status: "succeeded",
        input: args,
        output: result.output,
        latencyMs: result.latencyMs,
      });
      checkpoint.messages.push({
        role: "tool",
        content,
        tool_call_id: call.id,
        name: tool.name,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ["tool_outcome_unknown", "run_canceled"].includes(error.code)
      )
        throw error;
      const message =
        error instanceof AppError
          ? error.message
          : "Tool execution failed; details redacted";
      await appendToolResult(run, checkpoint, call, { error: message });
      await recordStep({
        runId: run.id,
        kind: "tool",
        name: tool.name,
        status: "failed",
        input: args,
        error: message,
      });
      checkpoint.messages.push({
        role: "tool",
        content: JSON.stringify({ error: message }),
        tool_call_id: call.id,
        name: tool.name,
      });
    }
    checkpoint.toolCalls += 1;
    checkpoint.pendingToolCalls = pending.filter(
      (item) =>
        !checkpoint.messages.some(
          (m) => m.role === "tool" && m.tool_call_id === item.id,
        ),
    );
    await persistCheckpoint(run.id, checkpoint);
  }

  checkpoint.pendingToolCalls = [];
  checkpoint.pendingApprovalId = undefined;
  await persistCheckpoint(run.id, checkpoint);
  await updateRun({
    runId: run.id,
    toolCalls: checkpoint.toolCalls,
    status: "running",
  });
  return false;
}

async function appendToolResult(
  run: NonNullable<RunRecord>,
  checkpoint: Checkpoint,
  call: ToolCall,
  result: unknown,
): Promise<void> {
  const content = typeof result === "string" ? result : JSON.stringify(result);
  await appendMessage({
    conversationId: run.conversation_id,
    runId: run.id,
    role: "tool",
    content,
    toolName: call.function.name,
    toolCallId: call.id,
  });
}

async function appendToolRejections(
  run: NonNullable<RunRecord>,
  _bootstrap: RuntimeBootstrapSnapshot,
  checkpoint: Checkpoint,
  approvalId: string,
): Promise<void> {
  const approval = await one<{
    tool_name: string;
    input: unknown;
    decision_note: string | null;
  }>("SELECT tool_name, input, decision_note FROM approval WHERE id = $1", [
    approvalId,
  ]);
  for (const call of checkpoint.pendingToolCalls ?? []) {
    const content = JSON.stringify({
      error: "人工审批拒绝执行该工具",
      note: approval?.decision_note ?? "",
    });
    checkpoint.messages.push({
      role: "tool",
      content,
      tool_call_id: call.id,
      name: call.function.name,
    });
  }
  await recordStep({
    runId: run.id,
    kind: "approval",
    name: approval?.tool_name ?? "approval",
    status: "failed",
    input: approval?.input ?? {},
    error: "人工审批拒绝",
  });
  await appendMessage({
    conversationId: run.conversation_id,
    runId: run.id,
    role: "system",
    content: "人工审批已拒绝，Agent 将继续给出替代建议。",
  });
}

async function createApproval(
  run: NonNullable<RunRecord>,
  bootstrap: RuntimeBootstrapSnapshot,
  calls: ToolCall[],
) {
  const first = calls[0]!;
  const tool = findTool(bootstrap, first.function.name);
  const row = await one<{
    id: string;
    run_id: string;
    tool_name: string;
    reason: string;
    input: unknown;
    status: "pending";
    requested_by: string;
    decided_by: null;
    decision_note: null;
    created_at: string;
    decided_at: null;
  }>(
    `INSERT INTO approval (run_id, tool_name, reason, input, status, requested_by)
     VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
     RETURNING *`,
    [
      run.id,
      calls.length > 1
        ? calls.map((call) => call.function.name).join(", ")
        : first.function.name,
      `工具 ${first.function.name} 需要人工确认${tool ? `（风险: ${tool.risk}）` : ""}`,
      JSON.stringify({
        toolCalls: calls.map((call) => ({
          name: call.function.name,
          arguments: safeJson(call.function.arguments),
        })),
      }),
      run.user_id,
    ],
  );
  if (!row) throw new Error("failed to create approval");
  return mapApproval(row);
}

function requiresApproval(
  tool: ToolPlanItem,
  definition: AgentDefinition,
): boolean {
  if (tool.approvalRequired || tool.risk === "high") return true;
  if (definition.approval.mode === "never") return false;
  if (definition.approval.mode === "always") return true;
  return false;
}

function findTool(
  bootstrap: RuntimeBootstrapSnapshot,
  name: string,
): ToolPlanItem | undefined {
  return bootstrap.toolPlan.tools.find((tool) => tool.name === name);
}

async function ensureLimits(
  run: NonNullable<RunRecord>,
  definition: AgentDefinition,
  checkpoint: Checkpoint,
): Promise<void> {
  if (checkpoint.toolCalls > definition.limits.maxToolCalls) {
    throw new AppError(
      422,
      "max_tool_calls",
      `超过最大工具调用次数 ${definition.limits.maxToolCalls}`,
    );
  }
  if (checkpoint.costUsd > definition.limits.maxCostUsd) {
    throw new AppError(
      422,
      "max_cost",
      `超过单次任务成本上限 $${definition.limits.maxCostUsd}`,
    );
  }
  if (run.started_at) {
    const elapsed = Date.now() - new Date(run.started_at).getTime();
    if (elapsed > definition.limits.timeoutMs) {
      throw new AppError(
        408,
        "timeout",
        `任务超过 ${Math.round(definition.limits.timeoutMs / 1000)} 秒`,
      );
    }
  }
}

async function ensureNotCanceled(runId: string): Promise<void> {
  if (
    !(await one(
      "SELECT o.id FROM org o JOIN agent_run r ON r.org_id=o.id WHERE r.id=$1 AND o.status='active'",
      [runId],
    ))
  )
    throw new AppError(403, "execution_access_revoked", "企业已停用");
  const row = await one<{ status: string; authorized: boolean }>(
    `SELECT r.status, EXISTS(SELECT 1 FROM membership m WHERE m.org_id=r.org_id AND m.user_id=r.user_id AND m.status='active') AND EXISTS(SELECT 1 FROM agent a WHERE a.id=r.agent_id AND a.org_id=r.org_id AND (a.personal_owner_id IS NULL OR (a.personal_owner_id=r.user_id AND r.project_id IS NULL))) AND (r.project_id IS NULL OR EXISTS(SELECT 1 FROM project_member pm WHERE pm.project_id=r.project_id AND pm.org_id=r.org_id AND pm.user_id=r.user_id AND pm.role!='viewer')) AS authorized FROM agent_run r WHERE r.id=$1`,
    [runId],
  );
  if (row?.status === "canceled")
    throw new AppError(409, "run_canceled", "Run canceled");
  if (!row?.authorized)
    throw new AppError(
      403,
      "execution_access_revoked",
      "Execution identity or project membership revoked",
    );
}

async function persistCheckpoint(
  runId: string,
  checkpoint: Checkpoint,
): Promise<void> {
  await updateRun({
    runId,
    checkpoint: checkpoint as unknown as Record<string, unknown>,
  });
}

async function emit(runId: string, event: RunEvent): Promise<void> {
  await recordEvent(runId, event);
}

async function failRun(
  run: NonNullable<RunRecord>,
  bootstrap: RuntimeBootstrapSnapshot,
  checkpoint: Checkpoint,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof AppError
      ? error.message
      : "Execution failed; provider details redacted";
  const status =
    error instanceof AppError && error.code === "timeout"
      ? "timeout"
      : "failed";
  await updateRun({
    runId: run.id,
    status,
    error: message.slice(0, 2000),
    turns: checkpoint.turn,
    toolCalls: checkpoint.toolCalls,
    inputTokens: checkpoint.inputTokens,
    outputTokens: checkpoint.outputTokens,
    costUsd: checkpoint.costUsd,
    finished: true,
  });
  const ended = await one<{ status: string }>(
    "SELECT status FROM agent_run WHERE id=$1",
    [run.id],
  );
  if (ended?.status !== status) return;
  await appendMessage({
    conversationId: run.conversation_id,
    runId: run.id,
    role: "system",
    content: `任务未完成：${message}`,
  });
  await emit(run.id, { type: "run.failed", runId: run.id, error: message });
  await recordUsage(run, bootstrap, checkpoint);
  await notifyQuietly(run.id, "failed");
}

async function notifyQuietly(
  runId: string,
  kind: "result" | "failed" | "approval",
): Promise<void> {
  try {
    await notifyChannelRun(runId, kind);
  } catch (error) {
    console.error("channel notify failed");
  }
}

async function recordUsage(
  run: NonNullable<RunRecord>,
  bootstrap: RuntimeBootstrapSnapshot,
  checkpoint: Checkpoint,
): Promise<void> {
  if (checkpoint.inputTokens === 0 && checkpoint.outputTokens === 0) return;
  await tx(async (c) => {
    await c.query("SELECT id FROM agent_run WHERE id=$1 FOR UPDATE", [run.id]);
    const prior = (
      await c.query<{ cost: string; input: string; output: string }>(
        "SELECT COALESCE(sum(cost_usd),0)::text AS cost,COALESCE(sum(input_tokens),0)::text AS input,COALESCE(sum(output_tokens),0)::text AS output FROM usage_record WHERE run_id=$1",
        [run.id],
      )
    ).rows[0]!;
    const cost = Math.max(0, checkpoint.costUsd - Number(prior.cost));
    const input = Math.max(0, checkpoint.inputTokens - Number(prior.input));
    const output = Math.max(0, checkpoint.outputTokens - Number(prior.output));
    if (!cost && !input && !output) return;
    await c.query(
      "INSERT INTO usage_record(org_id,run_id,agent_id,user_id,kind,input_tokens,output_tokens,quantity,cost_usd) VALUES($1,$2,$3,$4,'model',$5,$6,1,$7)",
      [run.org_id, run.id, run.agent_id, run.user_id, input, output, cost],
    );
    await c.query(
      "UPDATE quota SET current_cost_usd=CASE WHEN period_start<date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN $2 ELSE current_cost_usd+$2 END,current_runs=CASE WHEN period_start<date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN 0 ELSE current_runs END,period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' WHERE org_id=$1 AND scope='org' AND scope_id=$1",
      [run.org_id, cost],
    );
  });
  if (bootstrap.definition.memory.enabled && checkpoint.finalAnswer) {
    await query(
      `INSERT INTO memory (org_id, user_id, agent_id, key, value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, user_id, agent_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [
        run.org_id,
        run.user_id,
        run.agent_id,
        `last_run_${run.id.slice(0, 8)}`,
        checkpoint.finalAnswer.slice(0, 4000),
      ],
    );
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeJsonObject(value: string): Record<string, unknown> {
  const parsed = safeJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
