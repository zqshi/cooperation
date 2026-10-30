import { sensitiveMutation, transactionOne } from "../lib/guards.js";
import { z } from "zod";
import { sha256, forbidden } from "@workagent/core";
import type { FastifyInstance } from "fastify";
import {
  createChannelAccountSchema,
  type ChannelType,
} from "@workagent/contracts";
import {
  audit as baseAudit,
  createChannelAccount,
  encryptSecret,
  getChannelAccount,
  notFound,
  parseDingTalkEvent,
  parseFeishuEvent,
  processInboundMessage,
  sendChannelMessage,
  verifyDingTalkSignature,
  decryptSecret,
  verifyFeishuSignature,
  badRequest,
} from "@workagent/core";
import { one, query, tx } from "@workagent/db";
import { requireManage } from "../lib/guards.js";
import { config } from "@workagent/config";

type ChannelRow = {
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
  created_at: string;
  updated_at: string;
};

function mapChannel(row: ChannelRow) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    appId: row.app_id,
    defaultAgentId: row.default_agent_id,
    hasSecret: Boolean(row.app_secret_encrypted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const audit = baseAudit;

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { id: string } }>(
    "/channels/:id/bindings",
    async (request) => {
      requireManage(request.user);
      const input = z
        .object({
          userId: z.string().min(1),
          externalUserId: z.string().min(1).max(200),
        })
        .strict()
        .parse(request.body);
      await sensitiveMutation(request.user, "manage", async (client) => {
        const allowed = (
          await client.query(
            `SELECT a.id FROM channel_account a JOIN membership m ON m.org_id=a.org_id WHERE a.id=$1 AND a.org_id=$2 AND m.user_id=$3 AND m.status='active' FOR SHARE OF a,m`,
            [request.params.id, request.user.orgId, input.userId],
          )
        ).rows[0];
        if (!allowed) throw notFound();
        await client.query(
          `INSERT INTO channel_binding(org_id,account_id,user_id,external_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,external_user_id) DO UPDATE SET user_id=EXCLUDED.user_id`,
          [
            request.user.orgId,
            request.params.id,
            input.userId,
            input.externalUserId,
          ],
        );
        await audit(
          {
            orgId: request.user.orgId,
            actorId: request.user.id,
            action: "channel.binding",
            resourceType: "channel",
            resourceId: request.params.id,
          },
          client,
        );
      });
      return { ok: true };
    },
  );
  // Employee-safe projection: no credentials, external IDs or other members' bindings.
  app.get("/channels/mine", async (request) => {
    const items = await query<{
      id: string;
      name: string;
      type: ChannelType;
      status: string;
      configured: boolean;
      hasAgent: boolean;
    }>(
      `SELECT DISTINCT a.id,a.name,a.type,a.status,
        (a.app_id IS NOT NULL AND a.app_secret_encrypted IS NOT NULL) AS configured,
        (a.default_agent_id IS NOT NULL) AS "hasAgent"
       FROM channel_binding b JOIN channel_account a ON a.id=b.account_id AND a.org_id=b.org_id
       JOIN membership m ON m.org_id=b.org_id AND m.user_id=b.user_id AND m.status='active'
       WHERE b.org_id=$1 AND b.user_id=$2 AND a.type IN ('feishu','dingtalk') ORDER BY a.name,a.id`,
      [request.user.orgId, request.user.id],
    );
    return { items };
  });
  app.get("/channels", async (request) => {
    requireManage(request.user);
    const rows = await query<ChannelRow>(
      "SELECT * FROM channel_account WHERE org_id = $1 ORDER BY created_at",
      [request.user.orgId],
    );
    return { items: rows.map(mapChannel), total: rows.length };
  });

  app.post("/channels", async (request) => {
    return sensitiveMutation(request.user, "manage", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireManage(request.user);
      const input = createChannelAccountSchema.parse(request.body);
      const row = await createChannelAccount(
        {
          orgId: request.user.orgId,
          type: input.type,
          name: input.name,
          appId: input.appId,
          appSecret: input.appSecret,
          verificationToken: input.verificationToken,
          encryptKey: input.encryptKey,
          defaultAgentId: input.defaultAgentId,
        },
        client,
      );
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "channel.create",
        resourceType: "channel_account",
        resourceId: row.id,
        metadata: { type: row.type, name: row.name },
        ip: request.ip,
      });
      return { channel: mapChannel(row) };
    });
  });

  app.patch("/channels/:id", async (request) => {
    return sensitiveMutation(request.user, "manage", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireManage(request.user);
      const { id } = request.params as { id: string };
      const input = request.body as {
        name?: string;
        status?: string;
        appId?: string;
        appSecret?: string;
        verificationToken?: string;
        encryptKey?: string;
        defaultAgentId?: string | null;
      };
      const existing = await one<ChannelRow>(
        "SELECT * FROM channel_account WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [id, request.user.orgId],
      );
      if (!existing) throw notFound("渠道不存在");
      if (
        input.defaultAgentId &&
        !(await one(
          "SELECT id FROM agent WHERE id=$1 AND org_id=$2 AND personal_owner_id IS NULL",
          [input.defaultAgentId, request.user.orgId],
        ))
      )
        throw notFound();
      const secret =
        input.appSecret === undefined
          ? existing.app_secret_encrypted
          : input.appSecret === ""
            ? null
            : encryptSecret(input.appSecret);

      const row = await one<ChannelRow>(
        `UPDATE channel_account
          SET name = COALESCE($2, name),
              status = COALESCE($3, status),
              app_id = COALESCE($4, app_id),
              app_secret_encrypted = $5,
              verification_token = COALESCE($6, verification_token),
              encrypt_key = COALESCE($7, encrypt_key),
              default_agent_id = $8
        WHERE id = $1 AND org_id = $9
        RETURNING *`,
        [
          id,
          input.name ?? null,
          input.status ?? null,
          input.appId ?? null,
          secret,
          input.verificationToken === undefined
            ? null
            : encryptSecret(input.verificationToken),
          input.encryptKey === undefined
            ? null
            : encryptSecret(input.encryptKey),
          input.defaultAgentId === undefined
            ? existing.default_agent_id
            : input.defaultAgentId,
          request.user.orgId,
        ],
      );
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "channel.update",
        resourceType: "channel_account",
        resourceId: id,
        ip: request.ip,
      });
      return { channel: row ? mapChannel(row) : null };
    });
  });

  app.delete("/channels/:id", async (request) => {
    return sensitiveMutation(request.user, "manage", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireManage(request.user);
      const { id } = request.params as { id: string };
      const row = await one<ChannelRow>(
        "UPDATE channel_account SET status = 'disabled' WHERE id = $1 AND org_id = $2 RETURNING *",
        [id, request.user.orgId],
      );
      if (!row) throw notFound("渠道不存在");
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "channel.disable",
        resourceType: "channel_account",
        resourceId: id,
        ip: request.ip,
      });
      return { ok: true };
    });
  });

  app.post("/channels/:id/test", async (request) => {
    requireManage(request.user);
    const { id } = request.params as { id: string };
    const account = await getChannelAccount(id);
    if (!account || account.org_id !== request.user.orgId)
      throw notFound("渠道不存在");
    const input = request.body as {
      externalConversationId?: string;
      externalUserId?: string;
      text?: string;
    };
    if (!input.externalConversationId)
      throw badRequest("缺少 externalConversationId");
    await sendChannelMessage({
      accountId: account.id,
      channel: account.type,
      externalConversationId: input.externalConversationId,
      text: input.text ?? "WorkAgent 渠道测试消息",
      title: "WorkAgent 渠道测试",
      kind: "text",
      metadata: { externalUserId: input.externalUserId },
    });
    return { ok: true };
  });

  app.post("/channels/:type/:accountId/webhook", async (request, reply) => {
    const { type, accountId } = request.params as {
      type: ChannelType;
      accountId: string;
    };
    const account = await getChannelAccount(accountId);
    if (!account || account.type !== type) throw notFound("渠道账号不存在");

    const rawBody =
      (request as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (type === "feishu") {
      const headers = {
        timestamp: request.headers["x-lark-request-timestamp"] as
          string | undefined,
        nonce: request.headers["x-lark-request-nonce"] as string | undefined,
        signature: request.headers["x-lark-signature"] as string | undefined,
      };
      const valid = verifyFeishuSignature({
        headers,
        rawBody,
        encryptKey: account.encrypt_key ?? undefined,
        verificationToken: account.verification_token ?? undefined,
        body,
      });
      if (!valid) throw badRequest("飞书签名校验失败");
      const parsed = parseFeishuEvent(
        rawBody,
        body,
        account.encrypt_key ?? undefined,
      );
      if (parsed.kind === "challenge") return { challenge: parsed.challenge };
      if (parsed.kind === "ignored") return { code: 0, message: parsed.reason };
      const result = await processInboundMessage({
        channel: "feishu",
        signatureHash: sha256(String(headers.signature ?? "") + rawBody),
        accountId: account.id,
        externalEventId:
          (body.header as { event_id?: string } | undefined)?.event_id ??
          parsed.message.externalMessageId,
        message: parsed.message,
      });
      return { code: 0, runId: result.runId, duplicate: result.duplicate };
    }

    if (type === "dingtalk") {
      const valid = verifyDingTalkSignature({
        timestamp: request.headers.timestamp as string | undefined,
        sign: request.headers.sign as string | undefined,
        appSecret: account.app_secret_encrypted
          ? decryptSecret(account.app_secret_encrypted)
          : config.dingtalkClientSecret,
      });
      if (!valid) throw badRequest("钉钉签名校验失败");
      const parsed = parseDingTalkEvent(body);
      if (parsed.kind === "ignored")
        return { ok: true, message: parsed.reason };
      const result = await processInboundMessage({
        channel: "dingtalk",
        signatureHash: sha256(String(request.headers.sign ?? "") + rawBody),
        accountId: account.id,
        externalEventId: parsed.message.externalMessageId,
        message: parsed.message,
      });
      return { ok: true, runId: result.runId, duplicate: result.duplicate };
    }

    if (type === "mock") {
      if (config.isProd) throw notFound();
      const parsed = {
        externalUserId: String(body.externalUserId ?? "mock-user"),
        externalUserName: String(body.externalUserName ?? "Mock User"),
        externalConversationId: String(
          body.externalConversationId ?? "mock-chat",
        ),
        externalMessageId: String(
          body.externalMessageId ?? `mock-${Date.now()}`,
        ),
        text: String(body.text ?? ""),
        isGroup: Boolean(body.isGroup ?? false),
        raw: body,
      };
      if (!parsed.text.trim()) throw badRequest("消息为空");
      const result = await processInboundMessage({
        channel: "mock",
        accountId: account.id,
        externalEventId: parsed.externalMessageId,
        message: parsed,
      });
      return { ok: true, runId: result.runId, duplicate: result.duplicate };
    }

    return reply
      .status(501)
      .send({ error: { code: "not_implemented", message: "暂不支持该渠道" } });
  });
}
