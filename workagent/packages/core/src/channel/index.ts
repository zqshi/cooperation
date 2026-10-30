import type { PoolClient } from "pg";
import crypto from "node:crypto";
import { config } from "@workagent/config";
import type {
  ChannelType,
  InboundChannelMessage,
  OutboundChannelMessage,
} from "@workagent/contracts";
import { one, query, tx } from "@workagent/db";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  sha256,
} from "../crypto.js";
import { createRun } from "../runs.js";
import { enqueue } from "../queue.js";
import { AppError, notFound } from "../errors.js";
import { sendFeishuMessage } from "./feishu.js";
import { sendDingTalkMessage } from "./dingtalk.js";

type ChannelAccountRow = {
  created_at: string;
  updated_at: string;
  id: string;
  org_id: string;
  type: ChannelType;
  name: string;
  status: string;
  app_id: string | null;
  app_secret_encrypted: string | null;
  verification_token: string | null;
  encrypt_key: string | null;
  default_agent_id: string | null;
};

export async function getChannelAccount(
  accountId: string,
): Promise<ChannelAccountRow | null> {
  const row = await one<ChannelAccountRow>(
    "SELECT * FROM channel_account WHERE id=$1",
    [accountId],
  );
  if (!row) return null;
  const decode = (value: string | null) => {
    if (!value) return null;
    if (value.startsWith("v1:")) return decryptSecret(value);
    if (config.isProd)
      throw new AppError(
        503,
        "channel_key_rotation_required",
        "Rotate legacy channel credentials before production use",
      );
    return value;
  };
  return {
    ...row,
    verification_token: decode(row.verification_token),
    encrypt_key: decode(row.encrypt_key),
  };
}

export async function getChannelAccountByType(
  orgId: string,
  type: ChannelType,
): Promise<ChannelAccountRow | null> {
  return one<ChannelAccountRow>(
    "SELECT * FROM channel_account WHERE org_id = $1 AND type = $2 AND status = 'active' ORDER BY created_at LIMIT 1",
    [orgId, type],
  );
}

export async function createChannelAccount(
  input: {
    orgId: string;
    type: ChannelType;
    name: string;
    appId: string;
    appSecret: string;
    verificationToken: string;
    encryptKey: string;
    defaultAgentId?: string;
  },
  client?: import("pg").PoolClient,
): Promise<ChannelAccountRow> {
  const localOne = client
    ? async <T = Record<string, unknown>>(sql: string, params: unknown[]) =>
        (await client.query(sql, params)).rows[0] as T | undefined
    : one;
  if (config.isProd && input.type === "mock")
    throw new AppError(400, "mock_forbidden", "Mock channels forbidden");
  if (
    input.defaultAgentId &&
    !(await localOne("SELECT id FROM agent WHERE id=$1 AND org_id=$2 AND personal_owner_id IS NULL", [
      input.defaultAgentId,
      input.orgId,
    ]))
  )
    throw notFound("Agent 不存在");
  const row = await localOne<ChannelAccountRow>(
    `INSERT INTO channel_account
       (org_id, type, name, status, app_id, app_secret_encrypted, verification_token, encrypt_key, default_agent_id)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.orgId,
      input.type,
      input.name,
      input.appId || null,
      input.appSecret ? encryptSecret(input.appSecret) : null,
      input.verificationToken ? encryptSecret(input.verificationToken) : null,
      input.encryptKey ? encryptSecret(input.encryptKey) : null,
      input.defaultAgentId ?? null,
    ],
  );
  if (!row) throw new Error("failed to create channel account");
  return row;
}

export async function processInboundMessage(input: {
  channel: ChannelType;
  accountId: string;
  externalEventId: string;
  signatureHash?: string;
  message: Omit<InboundChannelMessage, "channel" | "accountId">;
}): Promise<{ runId: string; duplicate: boolean }> {
  return tx(async (client) => {
    const query = async <T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) => (await client.query(sql, params)).rows as T[];
    const one = async <T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) => (await query<T>(sql, params))[0] ?? null;
    const account = await one<ChannelAccountRow>(
      "SELECT * FROM channel_account WHERE id=$1 FOR SHARE",
      [input.accountId],
    );
    if (!account || account.org_id === "") throw notFound("渠道账号不存在");
    if (account.type !== input.channel) throw notFound("渠道类型不匹配");
    if (account.status !== "active")
      throw new AppError(403, "channel_disabled", "渠道已停用");

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,17))",
      [account.id],
    );
    const user = await resolveChannelUser(account, input.message, client);
    if (input.signatureHash) {
      const replay = await query(
        "INSERT INTO channel_replay(account_id,signature_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING account_id",
        [account.id, input.signatureHash],
      );
      if (!replay.length) return { runId: "", duplicate: true };
    }
    const eventInsert = await query<{ id: string }>(
      `INSERT INTO channel_event (org_id, account_id, external_event_id, event_type, payload)
     VALUES ($1, $2, $3, 'message', $4::jsonb)
     ON CONFLICT (account_id, external_event_id) DO NOTHING
     RETURNING id`,
      [
        account.org_id,
        account.id,
        input.externalEventId,
        JSON.stringify(input.message.raw ?? {}),
      ],
    );
    if (eventInsert.length === 0) return { runId: "", duplicate: true };

    const messageInsert = await query<{ id: string }>(
      `INSERT INTO channel_message (org_id, account_id, external_message_id, direction, payload)
     VALUES ($1, $2, $3, 'inbound', $4::jsonb)
     ON CONFLICT (account_id, external_message_id) DO NOTHING
     RETURNING id`,
      [
        account.org_id,
        account.id,
        input.message.externalMessageId,
        JSON.stringify(input.message),
      ],
    );
    if (messageInsert.length === 0) {
      await markEventProcessed(account.id, input.externalEventId, client);
      return { runId: "", duplicate: true };
    }

    const existingConversation = await one<{
      agent_id: string;
      conversation_id: string;
    }>(
      `SELECT agent_id, conversation_id FROM channel_conversation
      WHERE account_id = $1 AND external_conversation_id = $2 AND external_user_id=$3`,
      [
        account.id,
        input.message.externalConversationId,
        input.message.externalUserId,
      ],
    );

    const agentId =
      existingConversation?.agent_id ??
      account.default_agent_id ??
      (
        await one<{ id: string }>(
          "SELECT id FROM agent WHERE org_id = $1 AND status = 'published' AND personal_owner_id IS NULL ORDER BY updated_at DESC LIMIT 1",
          [account.org_id],
        )
      )?.id;
    if (!agentId)
      throw new AppError(409, "no_agent", "渠道没有可用的已发布 Agent");

    const result = await createRun(
      {
        orgId: account.org_id,
        userId: user.id,
        agentId,
        message: input.message.text,
        conversationId: existingConversation?.conversation_id,
        channel: account.type,
        idempotencyKey: `channel:${account.id}:${input.message.externalMessageId}`,
      },
      client,
    );

    if (!existingConversation) {
      await query(
        `INSERT INTO channel_conversation
         (org_id, account_id, agent_id, external_conversation_id, external_user_id, conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, external_conversation_id,external_user_id) DO NOTHING`,
        [
          account.org_id,
          account.id,
          agentId,
          input.message.externalConversationId,
          input.message.externalUserId,
          result.conversation.id,
        ],
      );
    }

    await markEventProcessed(account.id, input.externalEventId, client);
    return { runId: result.run.id, duplicate: false };
  });
}

async function resolveChannelUser(
  account: ChannelAccountRow,
  message: Omit<InboundChannelMessage, "channel" | "accountId">,
  client: PoolClient,
): Promise<{ id: string }> {
  const one = async <T>(sql: string, params: unknown[]) =>
    (await client.query(sql, params)).rows[0] as T | undefined;
  const binding = await one<{ user_id: string }>(
    `SELECT b.user_id FROM channel_binding b JOIN membership m ON m.org_id=b.org_id AND m.user_id=b.user_id WHERE b.account_id=$1 AND b.external_user_id=$2 AND b.org_id=$3 AND m.status='active' FOR SHARE OF b,m`,
    [account.id, message.externalUserId, account.org_id],
  );
  if (!binding)
    throw new AppError(
      403,
      "channel_unbound",
      "渠道身份必须由企业管理员绑定有效成员",
    );
  return { id: binding.user_id };
}

async function markEventProcessed(
  accountId: string,
  externalEventId: string,
  client?: PoolClient,
): Promise<void> {
  await (
    client
      ? (sql: string, params: unknown[]) => client.query(sql, params)
      : query
  )(
    "UPDATE channel_event SET processed_at = now() WHERE account_id = $1 AND external_event_id = $2",
    [accountId, externalEventId],
  );
}

export async function sendChannelMessage(
  message: OutboundChannelMessage,
): Promise<void> {
  const account = await getChannelAccount(message.accountId);
  if (!account) throw notFound("渠道账号不存在");
  if (account.status !== "active")
    throw new AppError(403, "channel_disabled", "渠道已停用");

  const secret = account.app_secret_encrypted
    ? decryptSecret(account.app_secret_encrypted)
    : "";
  if (account.type === "feishu") {
    await sendFeishuMessage({
      appId: account.app_id ?? "",
      appSecret: secret,
      externalConversationId: message.externalConversationId,
      text: message.text,
      title: message.title,
      url: message.url,
      kind: message.kind,
    });
  } else if (account.type === "dingtalk") {
    await sendDingTalkMessage({
      appId: account.app_id ?? config.dingtalkClientId,
      appSecret: secret || config.dingtalkClientSecret,
      robotCode: config.dingtalkRobotCode,
      externalConversationId: message.externalConversationId,
      externalUserId: String(message.metadata.externalUserId ?? ""),
      text: message.text,
      title: message.title,
      url: message.url,
      kind: message.kind,
    });
  } else if (account.type === "mock") {
    console.log(`[mock-channel] ${message.title ?? ""}\n${message.text}`);
  } else {
    throw new AppError(
      501,
      "channel_not_implemented",
      `暂不支持 ${account.type} 渠道发送`,
    );
  }

  await query(
    `INSERT INTO channel_message (org_id, account_id, external_message_id, direction, payload)
     VALUES ($1, $2, $3, 'outbound', $4::jsonb)`,
    [
      account.org_id,
      account.id,
      `out_${crypto.randomUUID()}`,
      JSON.stringify({ ...message, sentAt: new Date().toISOString() }),
    ],
  );
}

export async function notifyChannelRun(
  runId: string,
  kind: "result" | "failed" | "approval",
): Promise<void> {
  const row = await one<{
    account_id: string;
    account_type: ChannelType;
    external_conversation_id: string;
    external_user_id: string | null;
    output: string | null;
    error: string | null;
    agent_name: string;
  }>(
    `SELECT ca.id AS account_id, ca.type AS account_type,
            cc.external_conversation_id, cc.external_user_id,
            r.output, r.error, a.name AS agent_name
       FROM agent_run r
       JOIN channel_conversation cc ON cc.conversation_id = r.conversation_id
       JOIN channel_account ca ON ca.id = cc.account_id
       JOIN agent a ON a.id = r.agent_id
      WHERE r.id = $1 AND ca.status = 'active'`,
    [runId],
  );
  if (!row) return;

  const title =
    kind === "approval"
      ? `${row.agent_name} 需要人工审批`
      : kind === "failed"
        ? `${row.agent_name} 任务失败`
        : `${row.agent_name} 已完成`;
  const text =
    kind === "approval"
      ? "有高风险工具调用等待审批，请在 WorkAgent 中处理。"
      : kind === "failed"
        ? (row.error ?? "任务执行失败")
        : (row.output ?? "任务已完成");
  const url = `${config.userPortalOrigin.replace(/\/$/, "")}/tasks/${runId}`;

  await enqueue({
    orgId:
      (
        await one<{ org_id: string }>(
          "SELECT org_id FROM agent_run WHERE id = $1",
          [runId],
        )
      )?.org_id ?? "",
    type: "channel.send",
    payload: {
      accountId: row.account_id,
      channel: row.account_type,
      externalConversationId: row.external_conversation_id,
      externalUserId: row.external_user_id,
      text,
      title,
      url,
      kind,
      metadata: { externalUserId: row.external_user_id },
    },
  });
}
