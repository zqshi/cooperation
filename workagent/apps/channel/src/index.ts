import Fastify from "fastify";
import { config } from "@workagent/config";

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (request, body, done) => {
    (request as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  },
);

app.get("/healthz", async () => ({
  status: "ok",
  now: new Date().toISOString(),
}));

for (const type of config.isProd
  ? ["feishu", "dingtalk"]
  : ["feishu", "dingtalk", "mock"]) {
  app.post(`/${type}/:accountId`, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const rawBody =
      (request as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
    const headers: Record<string, string> = {
      "content-type": request.headers["content-type"] ?? "application/json",
    };
    for (const key of [
      "x-lark-request-timestamp",
      "x-lark-request-nonce",
      "x-lark-signature",
      "timestamp",
      "sign",
    ]) {
      const value = request.headers[key];
      if (typeof value === "string") headers[key] = value;
    }

    const response = await fetch(
      `${config.internalApiUrl.replace(/\/$/, "")}/v1/channels/${type}/${accountId}/webhook`,
      {
        method: "POST",
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    const text = await response.text();
    reply.status(response.status);
    if (
      (response.headers.get("content-type") ?? "").includes("application/json")
    ) {
      return reply.send(text ? JSON.parse(text) : {});
    }
    return reply.send(text);
  });
}

await app.listen({ port: config.channelPort, host: "0.0.0.0" });
console.log(
  `WorkAgent channel adapter listening on http://localhost:${config.channelPort}`,
);
