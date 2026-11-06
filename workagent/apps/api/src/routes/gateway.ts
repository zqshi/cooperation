import type { FastifyInstance } from "fastify";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { one, query, tx } from "@workagent/db";
import {
  forbidden,
  notFound,
  conflict,
  badRequest,
  publicAddress,
} from "@workagent/core";
import { config } from "@workagent/config";
const schema = z
  .object({
    hostname: z.string().trim().min(1).max(253),
    purpose: z.enum(["tool", "model", "both"]),
    reason: z.string().trim().min(5).max(1000),
    enabled: z.boolean(),
  })
  .strict();
async function validateHostname(input: string) {
  let host: string;
  try {
    host = new URL("https://" + input).hostname.toLowerCase();
  } catch {
    throw badRequest("请输入主机名，不要输入URL、路径或端口");
  }
  if (host !== input.toLowerCase() || host.includes("*") || isIP(host))
    throw badRequest("仅接受精确公共DNS主机名");
  try {
    const records = await lookup(host, { all: true });
    if (!records.length || records.some((r) => !publicAddress(r.address)))
      throw badRequest("主机解析到非公共网络，拒绝放行");
  } catch (e) {
    if (e instanceof Error && e.message.includes("非公共")) throw e;
    throw badRequest("主机DNS解析失败");
  }
  return host;
}
export async function gatewayRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (r) => {
    if (
      !(await one("SELECT user_id FROM platform_admin WHERE user_id=$1", [
        r.user.id,
      ]))
    )
      throw forbidden();
  });
  app.get("/gateway-control/upstreams", async () => ({
    items: await query(
      'SELECT id,hostname,purpose,reason,enabled,created_at AS "createdAt",updated_at AS "updatedAt" FROM gateway_upstream ORDER BY hostname',
    ),
    environmentAllowlist: config.toolAllowedHosts
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  }));
  app.post("/gateway-control/upstreams", async (r, reply) => {
    const input = schema.parse(r.body);
    const hostname = await validateHostname(input.hostname);
    return tx(async (c) => {
      if (
        !(
          await c.query(
            "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
            [r.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      let row;
      try {
        row = (
          await c.query(
            "INSERT INTO gateway_upstream(hostname,purpose,reason,enabled,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [hostname, input.purpose, input.reason, input.enabled, r.user.id],
          )
        ).rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          throw conflict("主机已登记");
        throw e;
      }
      await c.query(
        "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'gateway.upstream.create',$2)",
        [r.user.id, JSON.stringify({ id: row.id, ...input, hostname })],
      );
      reply.code(201);
      return { id: row.id };
    });
  });
  app.patch("/gateway-control/upstreams/:id", async (r) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(r.params);
    const input = schema.parse(r.body);
    const hostname = await validateHostname(input.hostname);
    return tx(async (c) => {
      if (
        !(
          await c.query(
            "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
            [r.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      const row = await c.query(
        "UPDATE gateway_upstream SET hostname=$2,purpose=$3,reason=$4,enabled=$5,updated_at=now() WHERE id=$1 RETURNING id",
        [id, hostname, input.purpose, input.reason, input.enabled],
      );
      if (!row.rowCount) throw notFound();
      await c.query(
        "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'gateway.upstream.update',$2)",
        [
          r.user.id,
          JSON.stringify({
            id,
            hostname,
            purpose: input.purpose,
            enabled: input.enabled,
          }),
        ],
      );
      return { ok: true };
    });
  });
  app.delete("/gateway-control/upstreams/:id", async (r) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(r.params);
    return tx(async (c) => {
      if (
        !(
          await c.query(
            "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
            [r.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      const row = await c.query(
        "DELETE FROM gateway_upstream WHERE id=$1 RETURNING hostname",
        [id],
      );
      if (!row.rowCount) throw notFound();
      await c.query(
        "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'gateway.upstream.delete',$2)",
        [r.user.id, JSON.stringify({ id, hostname: row.rows[0].hostname })],
      );
      return { ok: true };
    });
  });
  app.get("/gateway-control/status", async () => ({
    toolHosts:
      (
        await query<{ count: number }>(
          "SELECT count(*)::int AS count FROM gateway_upstream WHERE enabled AND purpose IN ('tool','both')",
        )
      )[0]?.count ?? 0,
    modelHosts:
      (
        await query<{ count: number }>(
          "SELECT count(*)::int AS count FROM gateway_upstream WHERE enabled AND purpose IN ('model','both')",
        )
      )[0]?.count ?? 0,
    proxyConfigured: false,
    description:
      "出口请求由 API 进程通过主机白名单和DNS公共地址校验发起；未配置独立代理网关。",
  }));
}
