import type { PoolClient } from "pg";
import type {
  Approval,
  Artifact,
  Conversation,
  Message,
  Run,
  RunDetail,
  RunEvent,
  RunStep,
  RuntimeBootstrapSnapshot,
} from "@workagent/contracts";
import { one, query, tx } from "@workagent/db";
import { stableChecksum } from "./crypto.js";
import { requireRunAccess, runAccessSql } from "./resource-access.js";
import { enqueueWithClient } from "./queue.js";
import { badRequest, conflict, notFound } from "./errors.js";

type RunRow = {
  id: string;
  org_id: string;
  project_id?: string | null;
  agent_id: string;
  revision_id: string;
  conversation_id: string;
  user_id: string;
  status: Run["status"];
  input: string;
  output: string | null;
  error: string | null;
  channel: string;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string | number;
  checkpoint: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConversationRow = {
  id: string;
  agent_id: string;
  user_id: string;
  title: string;
  channel: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: Message["role"];
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  created_at: string;
};

type StepRow = {
  id: string;
  run_id: string;
  seq: number;
  kind: RunStep["kind"];
  name: string;
  status: RunStep["status"];
  input: unknown;
  output: unknown;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
};

type ArtifactRow = {
  id: string;
  run_id: string;
  name: string;
  mime_type: string;
  size: number;
  storage_key: string;
  created_at: string;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  tool_name: string;
  reason: string;
  input: unknown;
  status: Approval["status"];
  requested_by: string;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
};

export function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id ?? null,
    agentId: row.agent_id,
    revisionId: row.revision_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    status: row.status,
    input: row.input,
    output: row.output,
    error: row.error,
    channel: row.channel,
    turns: row.turns,
    toolCalls: row.tool_calls,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Number(row.cost_usd),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    title: row.title,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    createdAt: row.created_at,
  };
}

export function mapStep(row: StepRow): RunStep {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    kind: row.kind,
    name: row.name,
    status: row.status,
    input: row.input,
    output: row.output,
    error: row.error,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

export function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    url: `/v1/artifacts/${row.id}/download`,
    createdAt: row.created_at,
  };
}

export function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    runId: row.run_id,
    toolName: row.tool_name,
    reason: row.reason,
    input: row.input,
    status: row.status,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export type CreateRunInput = {
  orgId: string;
  userId: string;
  agentId: string;
  projectId?: string;
  message: string;
  conversationId?: string;
  channel?: string;
  idempotencyKey?: string;
};

export async function createRun(
  input: CreateRunInput,
  transactionClient?: PoolClient,
): Promise<{
  run: Run;
  conversation: Conversation;
}> {
  const transact = transactionClient
    ? async <T>(fn: (client: PoolClient) => Promise<T>) => fn(transactionClient)
    : tx;
  return transact(async (client) => {
    const localOne = async <T>(sql: string, params: unknown[]) =>
      (await client.query(sql, params)).rows[0] as T | undefined;
    const fingerprint = stableChecksum({
      agentId: input.agentId,
      projectId: input.projectId ?? null,
      message: input.message,
      conversationId: input.conversationId ?? null,
      channel: input.channel ?? "web",
    });
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      input.orgId + ":run.create",
    ]);
    const active = await client.query(
      "SELECT user_id FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
      [input.orgId, input.userId],
    );
    if (!active.rowCount) throw notFound("Active identity required");
    if (input.idempotencyKey) {
      const existing = await client.query<{
        response: {
          runId: string;
          conversationId: string;
          fingerprint?: string;
        };
      }>(
        `SELECT response FROM idempotency_record
          WHERE org_id = $1 AND scope = 'run.create' AND key = $2`,
        [input.orgId, `${input.userId}:${input.idempotencyKey}`],
      );
      if (existing.rows[0]) {
        const saved = existing.rows[0].response;
        if (saved.fingerprint !== fingerprint)
          throw conflict("Idempotency key payload mismatch");
        const run = await localOne<RunRow>(
          "SELECT * FROM agent_run WHERE id=$1 AND org_id=$2",
          [saved.runId, input.orgId],
        );
        const conversation = await localOne<ConversationRow>(
          "SELECT * FROM conversation WHERE id=$1 AND org_id=$2",
          [saved.conversationId, input.orgId],
        );
        if (run) {
          const role = (
            await client.query<{ role: import("@workagent/contracts").Role }>(
              "SELECT role FROM membership WHERE org_id=$1 AND user_id=$2",
              [input.orgId, input.userId],
            )
          ).rows[0]!.role;
          await requireRunAccess(
            {
              id: input.userId,
              orgId: input.orgId,
              role,
              orgName: "",
              email: "",
              name: "",
              avatarUrl: null,
            },
            run.id,
            false,
            client,
          );
        }
        if (run && conversation)
          return {
            run: mapRun(run),
            conversation: mapConversation(conversation),
          };
        throw conflict("Idempotency result unavailable");
      }
    }

    const agent = await localOne<{
      id: string;
      name: string;
      status: string;
      current_revision_id: string | null;
    }>(
      "SELECT id, name, status, current_revision_id FROM agent WHERE id = $1 AND org_id = $2 AND (personal_owner_id IS NULL OR (personal_owner_id=$3 AND $4::boolean=false)) AND (visibility!='private' OR created_by=$3 OR EXISTS(SELECT 1 FROM membership WHERE org_id=$2 AND user_id=$3 AND status='active' AND role IN ('owner','admin','builder')))",
      [input.agentId, input.orgId, input.userId, Boolean(input.projectId)],
    );
    if (!agent) throw notFound("Agent 不存在");
    if (agent.status !== "published" || !agent.current_revision_id) {
      throw conflict("Agent 尚未发布，不能发起任务");
    }

    const revision = await localOne<{
      id: string;
      bootstrap: RuntimeBootstrapSnapshot | null;
    }>(
      "SELECT id, bootstrap FROM agent_revision WHERE id = $1 AND agent_id = $2",
      [agent.current_revision_id, agent.id],
    );
    if (!revision?.bootstrap) throw conflict("Agent 发布快照缺失，请重新发布");

    if (input.projectId) {
      await client.query(
        "SELECT id FROM project WHERE id=$1 AND org_id=$2 FOR SHARE",
        [input.projectId, input.orgId],
      );
      const member = await client.query(
        "SELECT pm.user_id FROM project_member pm JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id WHERE pm.org_id=$1 AND pm.project_id=$2 AND pm.user_id=$3 AND pm.role!='viewer' AND m.status='active' FOR SHARE OF pm,m",
        [input.orgId, input.projectId, input.userId],
      );
      if (!member.rowCount) throw notFound();
    }
    let conversation: ConversationRow;
    if (input.conversationId) {
      const found = await client.query<ConversationRow>(
        `SELECT id, agent_id, user_id, title, channel, created_at, updated_at
           FROM conversation
          WHERE id = $1 AND org_id = $2 AND user_id = $3 AND agent_id = $4`,
        [input.conversationId, input.orgId, input.userId, input.agentId],
      );
      if (!found.rows[0]) throw notFound("会话不存在");
      const linked = await client.query(
        "SELECT 1 FROM agent_run r WHERE r.project_id IS NOT NULL AND r.conversation_id=$1",
        [input.conversationId],
      );
      if (linked.rowCount)
        throw conflict("Project conversations must use task attempts");
      conversation = found.rows[0];
    } else {
      const created = await client.query<ConversationRow>(
        `INSERT INTO conversation (org_id, agent_id, user_id, title, channel)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, agent_id, user_id, title, channel, created_at, updated_at`,
        [
          input.orgId,
          input.agentId,
          input.userId,
          input.message.slice(0, 80),
          input.channel ?? "web",
        ],
      );
      conversation = created.rows[0]!;
    }

    await client.query(
      `INSERT INTO message (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [conversation.id, input.message],
    );

    const runResult = await client.query<RunRow>(
      `INSERT INTO agent_run
         (org_id, agent_id, revision_id, conversation_id, user_id, status, input, channel,project_id)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7,$8)
       RETURNING *`,
      [
        input.orgId,
        input.agentId,
        revision.id,
        conversation.id,
        input.userId,
        input.message,
        input.channel ?? "web",
        input.projectId ?? null,
      ],
    );
    const runRow = runResult.rows[0]!;

    if (input.idempotencyKey) {
      await client.query(
        `INSERT INTO idempotency_record (org_id, scope, key, response)
         VALUES ($1, 'run.create', $2, $3::jsonb)`,
        [
          input.orgId,
          `${input.userId}:${input.idempotencyKey}`,
          JSON.stringify({
            runId: runRow.id,
            conversationId: conversation.id,
            fingerprint,
          }),
        ],
      );
    }

    {
      await client.query(
        "UPDATE quota SET current_runs=0,current_cost_usd=0,period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' WHERE org_id=$1 AND period_start < date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [input.orgId],
      );
      const locked = (
        await client.query<{
          current_runs: number;
          monthly_run_limit: number;
          current_cost_usd: string;
          monthly_budget_usd: string;
        }>(
          "SELECT current_runs,monthly_run_limit,current_cost_usd,monthly_budget_usd FROM quota WHERE org_id=$1 AND scope='org' AND scope_id=$1 FOR UPDATE",
          [input.orgId],
        )
      ).rows[0];
      if (
        locked &&
        (locked.current_runs >= locked.monthly_run_limit ||
          Number(locked.current_cost_usd) >= Number(locked.monthly_budget_usd))
      )
        throw conflict("Run quota exceeded");
      await client.query(
        `UPDATE quota SET current_runs = current_runs + 1
          WHERE org_id = $1 AND scope = 'org' AND scope_id = $1`,
        [input.orgId],
      );
    }

    await enqueueWithClient(client, {
      orgId: input.orgId,
      type: "run.execute",
      payload: { runId: runRow.id },
    });

    return { run: mapRun(runRow), conversation: mapConversation(conversation) };
  });
}

export async function getRunDetail(
  runId: string,
  orgId: string,
): Promise<RunDetail | null> {
  const run = await one<RunRow>(
    "SELECT * FROM agent_run WHERE id = $1 AND org_id = $2",
    [runId, orgId],
  );
  if (!run) return null;

  const conversation = await one<ConversationRow>(
    "SELECT * FROM conversation WHERE id = $1",
    [run.conversation_id],
  );
  if (!conversation) return null;

  const [messages, steps, artifacts, approval] = await Promise.all([
    query<MessageRow>(
      "SELECT * FROM message WHERE conversation_id = $1 ORDER BY created_at",
      [run.conversation_id],
    ),
    query<StepRow>("SELECT * FROM run_step WHERE run_id = $1 ORDER BY seq", [
      run.id,
    ]),
    query<ArtifactRow>(
      "SELECT * FROM artifact WHERE run_id = $1 ORDER BY created_at",
      [run.id],
    ),
    one<ApprovalRow>(
      "SELECT * FROM approval WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1",
      [run.id],
    ),
  ]);

  return {
    run: mapRun(run),
    conversation: mapConversation(conversation),
    messages: messages.map(mapMessage),
    steps: steps.map(mapStep),
    artifacts: artifacts.map(mapArtifact),
    approval: approval ? mapApproval(approval) : null,
  };
}

export async function getRunRecord(
  runId: string,
  orgId: string,
): Promise<(RunRow & { revision_bootstrap: RuntimeBootstrapSnapshot }) | null> {
  const run = await one<
    RunRow & { revision_bootstrap: RuntimeBootstrapSnapshot }
  >(
    `SELECT r.*, rev.bootstrap AS revision_bootstrap
       FROM agent_run r
       JOIN agent_revision rev ON rev.id = r.revision_id
      WHERE r.id = $1 AND r.org_id = $2`,
    [runId, orgId],
  );
  return run ?? null;
}

export async function appendMessage(input: {
  conversationId: string;
  runId?: string;
  role: Message["role"];
  content: string;
  toolName?: string;
  toolCallId?: string;
}): Promise<Message> {
  const row = await one<MessageRow>(
    `INSERT INTO message (conversation_id, run_id, role, content, tool_name, tool_call_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.conversationId,
      input.runId ?? null,
      input.role,
      input.content,
      input.toolName ?? null,
      input.toolCallId ?? null,
    ],
  );
  if (!row) throw new Error("failed to append message");
  return mapMessage(row);
}

export async function recordEvent(
  runId: string,
  event: RunEvent,
): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT id FROM agent_run WHERE id=$1 FOR UPDATE", [
      runId,
    ]);
    const seqResult = await client.query<{ seq: number }>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_event WHERE run_id = $1",
      [runId],
    );
    const seq = seqResult.rows[0]?.seq ?? 1;
    await client.query(
      `INSERT INTO run_event (run_id, seq, type, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      [runId, seq, event.type, JSON.stringify(event)],
    );
  });
}

export async function recordStep(input: {
  runId: string;
  kind: RunStep["kind"];
  name: string;
  status: RunStep["status"];
  input?: unknown;
  output?: unknown;
  error?: string | null;
  latencyMs?: number | null;
}): Promise<RunStep> {
  const row = await tx(async (client) => {
    await client.query("SELECT id FROM agent_run WHERE id=$1 FOR UPDATE", [
      input.runId,
    ]);
    const seqResult = await client.query<{ seq: number }>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_step WHERE run_id = $1",
      [input.runId],
    );
    const seq = seqResult.rows[0]?.seq ?? 1;
    const inserted = await client.query<StepRow>(
      `INSERT INTO run_step (run_id, seq, kind, name, status, input, output, error, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       RETURNING *`,
      [
        input.runId,
        seq,
        input.kind,
        input.name,
        input.status,
        JSON.stringify(input.input ?? null),
        JSON.stringify(input.output ?? null),
        input.error ?? null,
        input.latencyMs ?? null,
      ],
    );
    return inserted.rows[0]!;
  });
  const step = mapStep(row);
  await recordEvent(input.runId, {
    type: "step.completed",
    runId: input.runId,
    step,
  });
  return step;
}

export async function getRunEvents(
  runId: string,
  afterSeq: number,
): Promise<
  Array<{ seq: number; type: string; payload: RunEvent; createdAt: string }>
> {
  const rows = await query<{
    seq: number;
    type: string;
    payload: RunEvent;
    created_at: string;
  }>(
    "SELECT seq, type, payload, created_at FROM run_event WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT 200",
    [runId, afterSeq],
  );
  return rows.map((row) => ({
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

export async function decideApproval(input: {
  approvalId: string;
  orgId: string;
  userId: string;
  decision: "approve" | "reject";
  note: string;
}): Promise<Approval> {
  const updated = await tx(async (client) => {
    const actor = (
      await client.query<{ role: import("@workagent/contracts").Role }>(
        "SELECT role FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active'",
        [input.orgId, input.userId],
      )
    ).rows[0];
    const linked = (
      await client.query<{ run_id: string }>(
        "SELECT a.run_id FROM approval a JOIN agent_run r ON r.id=a.run_id WHERE a.id=$1 AND r.org_id=$2",
        [input.approvalId, input.orgId],
      )
    ).rows[0];
    if (!actor || !linked) throw notFound();
    await requireRunAccess(
      {
        id: input.userId,
        orgId: input.orgId,
        role: actor.role,
        orgName: "",
        email: "",
        name: "",
        avatarUrl: null,
      },
      linked.run_id,
      "write",
      client,
    );

    const found = await client.query<
      ApprovalRow & { org_id: string; run_status: string }
    >(
      `SELECT a.*,r.org_id,r.status AS run_status FROM approval a JOIN agent_run r ON r.id=a.run_id WHERE a.id=$1 AND r.org_id=$2 FOR UPDATE OF r,a`,
      [input.approvalId, input.orgId],
    );
    const approval = found.rows[0];
    if (!approval) throw notFound("审批不存在");
    const decision = input.decision === "approve" ? "approved" : "rejected";
    if (approval.status === decision && approval.decided_by === input.userId)
      return approval;
    if (
      approval.status !== "pending" ||
      approval.run_status !== "waiting_approval"
    )
      throw conflict("审批已处理或执行已结束");
    const result = await client.query<ApprovalRow>(
      "UPDATE approval SET status=$2,decided_by=$3,decision_note=$4,decided_at=now() WHERE id=$1 RETURNING *",
      [input.approvalId, decision, input.userId, input.note],
    );
    // Preserve waiting_approval: engine must interpret rejected approvals before resuming.
    await enqueueWithClient(client, {
      orgId: input.orgId,
      type: "run.execute",
      payload: { runId: approval.run_id, resume: true },
    });
    await client.query(
      "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id) VALUES($1,$2,$3,'approval',$4)",
      [input.orgId, input.userId, "approval." + decision, input.approvalId],
    );
    return result.rows[0]!;
  });
  return mapApproval(updated);
}

export async function cancelRun(
  runId: string,
  orgId: string,
  actorId?: string,
): Promise<Run> {
  return tx(async (client) => {
    if (actorId) {
      const actor = (
        await client.query<{ role: import("@workagent/contracts").Role }>(
          "SELECT role FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active'",
          [orgId, actorId],
        )
      ).rows[0];
      if (!actor) throw notFound();
      await requireRunAccess(
        {
          id: actorId,
          orgId,
          role: actor.role,
          orgName: "",
          email: "",
          name: "",
          avatarUrl: null,
        },
        runId,
        "write",
        client,
      );
    }
    const row = (
      await client.query<RunRow>(
        "SELECT * FROM agent_run WHERE id=$1 AND org_id=$2 FOR UPDATE",
        [runId, orgId],
      )
    ).rows[0];
    if (!row) throw notFound();
    if (row.status === "canceled") return mapRun(row);
    if (!["queued", "running", "waiting_approval"].includes(row.status))
      throw conflict("任务已结束");
    const run = (
      await client.query<RunRow>(
        "UPDATE agent_run SET status='canceled',finished_at=now(),error='canceled by user' WHERE id=$1 RETURNING *",
        [runId],
      )
    ).rows[0]!;
    await client.query(
      "UPDATE approval SET status='expired',decided_at=now() WHERE run_id=$1 AND status='pending'",
      [runId],
    );
    await client.query(
      "INSERT INTO audit_log(org_id,action,resource_type,resource_id,actor_id) VALUES($1,'run.cancel','run',$2,$3)",
      [orgId, runId, actorId ?? row.user_id],
    );
    const seq = (
      await client.query<{ seq: number }>(
        "SELECT COALESCE(MAX(seq),0)+1 AS seq FROM run_event WHERE run_id=$1",
        [runId],
      )
    ).rows[0]!.seq;
    await client.query(
      "INSERT INTO run_event(run_id,seq,type,payload) VALUES($1,$2,'run.status',$3::jsonb)",
      [
        runId,
        seq,
        JSON.stringify({
          type: "run.status",
          runId,
          status: "canceled",
          at: new Date().toISOString(),
        }),
      ],
    );
    return mapRun(run);
  });
}

export async function listRuns(input: {
  orgId: string;
  userId: string;
  all?: boolean;
  personalOnly?: boolean;
  agentId?: string;
  status?: string;
  limit: number;
  offset: number;
}): Promise<{ items: Array<Run & { agentName: string }>; total: number }> {
  const conditions = ["r.org_id = $1"];
  const params: unknown[] = [input.orgId, input.userId, input.all ?? false];
  conditions.push(runAccessSql("$2", "$3"));
  if (input.personalOnly)
    conditions.push("r.project_id IS NULL AND r.user_id=$2");
  if (input.agentId) {
    params.push(input.agentId);
    conditions.push(`r.agent_id = $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    conditions.push(`r.status = $${params.length}`);
  }
  const total = Number(
    (
      await one<{ count: string }>(
        `SELECT count(*)::text AS count FROM agent_run r WHERE ${conditions.join(" AND ")}`,
        params,
      )
    )?.count ?? 0,
  );
  params.push(input.limit, input.offset);
  const rows = await query<RunRow & { agent_name: string }>(
    `SELECT r.*, a.name AS agent_name
       FROM agent_run r JOIN agent a ON a.id = r.agent_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.map((row) => ({ ...mapRun(row), agentName: row.agent_name })),
    total,
  };
}

export async function listConversations(input: {
  orgId: string;
  userId: string;
  limit: number;
  offset: number;
}): Promise<{
  items: Array<
    Conversation & { agentName: string; lastMessage: string | null }
  >;
  total: number;
}> {
  const total = Number(
    (
      await one<{ count: string }>(
        `SELECT count(*)::text AS count FROM conversation c WHERE c.org_id = $1 AND (c.user_id=$2 OR EXISTS(SELECT 1 FROM agent_run r JOIN project_member pm ON pm.project_id=r.project_id AND pm.org_id=r.org_id WHERE r.conversation_id=c.id AND pm.user_id=$2)) AND NOT EXISTS(SELECT 1 FROM agent_run r WHERE r.conversation_id=c.id AND NOT ${runAccessSql("$2", "false")})`,
        [input.orgId, input.userId],
      )
    )?.count ?? 0,
  );
  const rows = await query<
    ConversationRow & { agent_name: string; last_message: string | null }
  >(
    `SELECT c.*, a.name AS agent_name,
            (SELECT content FROM message m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM conversation c JOIN agent a ON a.id = c.agent_id
      WHERE c.org_id = $1 AND (c.user_id=$2 OR EXISTS(SELECT 1 FROM agent_run r JOIN project_member pm ON pm.project_id=r.project_id AND pm.org_id=r.org_id WHERE r.conversation_id=c.id AND pm.user_id=$2)) AND NOT EXISTS(SELECT 1 FROM agent_run r WHERE r.conversation_id=c.id AND NOT ${runAccessSql("$2", "false")})
      ORDER BY c.updated_at DESC
      LIMIT $3 OFFSET $4`,
    [input.orgId, input.userId, input.limit, input.offset],
  );
  return {
    items: rows.map((row) => ({
      ...mapConversation(row),
      agentName: row.agent_name,
      lastMessage: row.last_message,
    })),
    total,
  };
}

export async function getConversationMessages(
  conversationId: string,
  orgId: string,
  userId: string,
): Promise<Message[] | null> {
  const conversation = await one<{ id: string }>(
    `SELECT c.id FROM conversation c WHERE c.id=$1 AND c.org_id=$2 AND (c.user_id=$3 OR EXISTS(SELECT 1 FROM agent_run r JOIN project_member pm ON pm.project_id=r.project_id AND pm.org_id=r.org_id WHERE r.conversation_id=c.id AND pm.user_id=$3)) AND NOT EXISTS(SELECT 1 FROM agent_run r WHERE r.conversation_id=c.id AND NOT ${runAccessSql("$3", "false")})`,
    [conversationId, orgId, userId],
  );
  if (!conversation) return null;
  const rows = await query<MessageRow>(
    "SELECT * FROM message WHERE conversation_id = $1 ORDER BY created_at",
    [conversationId],
  );
  return rows.map(mapMessage);
}

export async function updateRun(input: {
  runId: string;
  status?: Run["status"];
  output?: string | null;
  error?: string | null;
  turns?: number;
  toolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  checkpoint?: Record<string, unknown>;
  started?: boolean;
  finished?: boolean;
}): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [input.runId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    sets.push(`${sql} = $${params.length}`);
  };
  if (input.status !== undefined) add("status", input.status);
  if (input.output !== undefined) add("output", input.output);
  if (input.error !== undefined) add("error", input.error);
  if (input.turns !== undefined) add("turns", input.turns);
  if (input.toolCalls !== undefined) add("tool_calls", input.toolCalls);
  if (input.inputTokens !== undefined) add("input_tokens", input.inputTokens);
  if (input.outputTokens !== undefined)
    add("output_tokens", input.outputTokens);
  if (input.costUsd !== undefined) add("cost_usd", input.costUsd);
  if (input.checkpoint !== undefined) {
    params.push(JSON.stringify(input.checkpoint));
    sets.push(`checkpoint = $${params.length}::jsonb`);
  }
  if (input.started) sets.push("started_at = COALESCE(started_at, now())");
  if (input.finished) sets.push("finished_at = now()");
  if (sets.length === 0) return;
  await query(
    `UPDATE agent_run SET ${sets.join(", ")} WHERE id = $1 AND status NOT IN ('canceled','timeout','failed','succeeded')`,
    params,
  );
}

export async function expirePendingApprovals(): Promise<number> {
  return tx(async (c) => {
    const runs = await c.query<{ id: string; org_id: string }>(
      `SELECT r.id,r.org_id FROM agent_run r WHERE r.status='waiting_approval' AND EXISTS(SELECT 1 FROM approval a WHERE a.run_id=r.id AND a.status='pending' AND a.created_at<now()-interval '24 hours') FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const run of runs.rows) {
      await c.query(
        "UPDATE approval SET status='expired',decided_at=now() WHERE run_id=$1 AND status='pending'",
        [run.id],
      );
      await c.query(
        "UPDATE agent_run SET status='timeout',finished_at=now(),error='approval expired' WHERE id=$1",
        [run.id],
      );
      await c.query(
        "INSERT INTO audit_log(org_id,action,resource_type,resource_id) VALUES($1,'approval.expired','run',$2)",
        [run.org_id, run.id],
      );
    }
    return runs.rowCount ?? 0;
  });
}

export function assertRunStatus(run: Run, allowed: Run["status"][]): void {
  if (!allowed.includes(run.status)) {
    throw badRequest(`Run 当前状态为 ${run.status}，无法执行该操作`);
  }
}
