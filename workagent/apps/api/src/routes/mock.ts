import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";

export async function mockRoutes(app: FastifyInstance): Promise<void> {
  app.post("/tools/lookup_order", async (request) => {
    const body = (request.body ?? {}) as { orderId?: string };
    const orderId = body.orderId ?? "A20260101";
    const hash = crypto.createHash("sha256").update(orderId).digest();
    const statuses = ["已发货", "待发货", "已签收", "处理中"];
    const status = statuses[hash[0]! % statuses.length];
    const amount = 100 + (hash.readUInt16BE(1) % 9000) / 10;
    return {
      orderId,
      status,
      amount: Number(amount.toFixed(2)),
      logistics: `${status === "已发货" || status === "已签收" ? "顺丰速运 SF" : "仓库处理中"} ${orderId.slice(-6)}`,
      updatedAt: new Date().toISOString(),
    };
  });

  app.post("/tools/echo", async (request) => ({
    echo: request.body ?? null,
    at: new Date().toISOString(),
  }));
}
