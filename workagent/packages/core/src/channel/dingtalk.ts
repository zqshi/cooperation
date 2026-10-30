import crypto from "node:crypto";
import type { InboundChannelMessage } from "@workagent/contracts";
import { AppError } from "../errors.js";

export function verifyDingTalkSignature(input: {
  timestamp?: string;
  sign?: string;
  appSecret?: string;
}): boolean {
  if (
    !input.timestamp ||
    !input.sign ||
    !input.appSecret ||
    !Number.isFinite(Number(input.timestamp)) ||
    Math.abs(Date.now() - Number(input.timestamp)) > 300_000
  )
    return false;
  const expected = crypto
    .createHmac("sha256", input.appSecret)
    .update(`${input.timestamp}\n${input.appSecret}`)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(input.sign);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type DingTalkParseResult =
  | {
      kind: "message";
      message: Omit<InboundChannelMessage, "channel" | "accountId">;
    }
  | { kind: "ignored"; reason: string };

export function parseDingTalkEvent(
  body: Record<string, unknown>,
): DingTalkParseResult {
  const msgtype = String(body.msgtype ?? "");
  if (msgtype !== "text") {
    return { kind: "ignored", reason: `unsupported msgtype: ${msgtype}` };
  }
  const textBody = body.text as { content?: string } | undefined;
  const text = (textBody?.content ?? "").replace(/@\S+/g, "").trim();
  if (!text) return { kind: "ignored", reason: "empty text" };

  const senderStaffId = String(body.senderStaffId ?? body.senderId ?? "");
  const conversationId = String(body.conversationId ?? "");
  const msgId = String(body.msgId ?? "");
  if (!senderStaffId || !conversationId || !msgId) {
    return {
      kind: "ignored",
      reason: "sender/conversation/message id missing",
    };
  }

  return {
    kind: "message",
    message: {
      externalUserId: senderStaffId,
      externalUserName: String(body.senderNick ?? ""),
      externalConversationId: conversationId,
      externalMessageId: msgId,
      text,
      isGroup: String(body.conversationType ?? "1") === "2",
      raw: body,
    },
  };
}

export async function getDingTalkAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch(
    "https://api.dingtalk.com/v1.0/oauth2/accessToken",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const data = (await response.json()) as {
    accessToken?: string;
    message?: string;
  };
  if (!response.ok || !data.accessToken) {
    throw new AppError(
      502,
      "dingtalk_error",
      `获取钉钉 token 失败: ${data.message ?? response.status}`,
    );
  }
  return data.accessToken;
}

export async function sendDingTalkMessage(input: {
  appId: string;
  appSecret: string;
  robotCode: string;
  externalConversationId: string;
  externalUserId?: string;
  text: string;
  title?: string;
  url?: string;
  kind: string;
}): Promise<void> {
  const token = await getDingTalkAccessToken(input.appId, input.appSecret);
  const isGroup =
    input.externalConversationId.startsWith("cid") ||
    input.externalConversationId.startsWith("group");
  const text = input.url
    ? `${input.text}\n\n查看详情：${input.url}`
    : input.text;

  if (isGroup) {
    const response = await fetch(
      "https://api.dingtalk.com/v1.0/robot/groupMessages/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify({
          robotCode: input.robotCode,
          openConversationId: input.externalConversationId,
          msgKey: "sampleText",
          msgParam: JSON.stringify({ content: text.slice(0, 20000) }),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw new AppError(
        502,
        "dingtalk_error",
        `发送钉钉群消息失败: ${response.status}`,
      );
    }
    return;
  }

  if (!input.externalUserId) {
    throw new AppError(502, "dingtalk_error", "钉钉单聊缺少 externalUserId");
  }
  const response = await fetch(
    "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify({
        robotCode: input.robotCode,
        userIds: [input.externalUserId],
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content: text.slice(0, 20000) }),
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new AppError(
      502,
      "dingtalk_error",
      `发送钉钉单聊消息失败: ${response.status}`,
    );
  }
}
