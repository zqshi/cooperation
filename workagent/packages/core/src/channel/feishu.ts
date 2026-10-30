import crypto from "node:crypto";
import type { InboundChannelMessage } from "@workagent/contracts";
import { AppError, badRequest } from "../errors.js";

type FeishuHeaders = {
  timestamp?: string;
  nonce?: string;
  signature?: string;
};

export function verifyFeishuSignature(input: {
  headers: FeishuHeaders;
  rawBody: string;
  encryptKey?: string;
  verificationToken?: string;
  body: Record<string, unknown>;
}): boolean {
  const { timestamp, nonce, signature } = input.headers;
  if (
    !timestamp ||
    !Number.isFinite(Number(timestamp)) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  if (input.encryptKey && timestamp && nonce && signature) {
    const expected = crypto
      .createHash("sha256")
      .update(`${timestamp}${nonce}${input.encryptKey}${input.rawBody}`)
      .digest("hex");
    return timingEqual(expected, signature);
  }
  if (input.verificationToken) {
    return input.body.token === input.verificationToken;
  }
  return false;
}

function timingEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function decryptFeishu(encrypted: string, encryptKey: string): string {
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const buffer = Buffer.from(encrypted, "base64");
  const iv = buffer.subarray(0, 16);
  const data = buffer.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

export type FeishuParseResult =
  | { kind: "challenge"; challenge: string }
  | {
      kind: "message";
      message: Omit<InboundChannelMessage, "channel" | "accountId">;
    }
  | { kind: "ignored"; reason: string };

export function parseFeishuEvent(
  rawBody: string,
  body: Record<string, unknown>,
  encryptKey?: string,
): FeishuParseResult {
  let payload = body;
  if (typeof body.encrypt === "string") {
    if (!encryptKey) throw badRequest("收到加密事件，但未配置 Encrypt Key");
    payload = JSON.parse(decryptFeishu(body.encrypt, encryptKey)) as Record<
      string,
      unknown
    >;
  }

  if (
    payload.type === "url_verification" &&
    typeof payload.challenge === "string"
  ) {
    return { kind: "challenge", challenge: payload.challenge };
  }

  const header = payload.header as
    | { event_id?: string; event_type?: string; create_time?: string }
    | undefined;
  if (header?.event_type !== "im.message.receive_v1") {
    return {
      kind: "ignored",
      reason: `unsupported event: ${header?.event_type ?? "unknown"}`,
    };
  }

  const event = payload.event as
    | {
        sender?: {
          sender_id?: { open_id?: string; union_id?: string; user_id?: string };
          sender_type?: string;
        };
        message?: {
          message_id?: string;
          chat_id?: string;
          chat_type?: string;
          message_type?: string;
          content?: string;
        };
      }
    | undefined;

  const message = event?.message;
  if (!message?.message_id || !message.chat_id) {
    return { kind: "ignored", reason: "message id/chat id missing" };
  }
  if (message.message_type !== "text") {
    return {
      kind: "ignored",
      reason: `unsupported message type: ${message.message_type}`,
    };
  }

  let text = "";
  try {
    const content = JSON.parse(message.content ?? "{}") as { text?: string };
    text = content.text ?? "";
  } catch {
    return { kind: "ignored", reason: "invalid message content" };
  }
  text = text.replace(/@_user_\d+/g, "").trim();
  if (!text) return { kind: "ignored", reason: "empty text" };

  const externalUserId =
    event?.sender?.sender_id?.open_id ??
    event?.sender?.sender_id?.union_id ??
    event?.sender?.sender_id?.user_id;
  if (!externalUserId) return { kind: "ignored", reason: "sender id missing" };

  return {
    kind: "message",
    message: {
      externalUserId,
      externalUserName: "",
      externalConversationId: message.chat_id,
      externalMessageId: message.message_id,
      text,
      isGroup: message.chat_type === "group",
      raw: payload,
    },
  };
}

export async function getFeishuTenantToken(
  appId: string,
  appSecret: string,
): Promise<string> {
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
  };
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new AppError(
      502,
      "feishu_error",
      `获取飞书 token 失败: ${data.msg ?? response.status}`,
    );
  }
  return data.tenant_access_token;
}

export async function sendFeishuMessage(input: {
  appId: string;
  appSecret: string;
  externalConversationId: string;
  text: string;
  title?: string;
  url?: string;
  kind: string;
}): Promise<void> {
  const token = await getFeishuTenantToken(input.appId, input.appSecret);
  const isCard =
    input.kind === "card" ||
    input.kind === "approval" ||
    input.kind === "result";
  const content = isCard
    ? JSON.stringify({
        config: { wide_screen_mode: true },
        header: {
          title: { tag: "plain_text", content: input.title ?? "WorkAgent" },
        },
        elements: [
          {
            tag: "div",
            text: { tag: "lark_md", content: input.text.slice(0, 20000) },
          },
          ...(input.url
            ? [
                {
                  tag: "action",
                  actions: [
                    {
                      tag: "button",
                      text: { tag: "plain_text", content: "查看详情" },
                      type: "primary",
                      url: input.url,
                    },
                  ],
                },
              ]
            : []),
        ],
      })
    : JSON.stringify({ text: input.text.slice(0, 20000) });

  const response = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: input.externalConversationId,
        msg_type: isCard ? "interactive" : "text",
        content,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const data = (await response.json()) as { code?: number; msg?: string };
  if (!response.ok || data.code !== 0) {
    throw new AppError(
      502,
      "feishu_error",
      `发送飞书消息失败: ${data.msg ?? response.status}`,
    );
  }
}
