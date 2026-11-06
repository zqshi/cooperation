import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, query } from "@workagent/db";
import {
  encryptSecret,
  decryptSecret,
  notFound,
  conflict,
  badRequest,
} from "@workagent/core";
import { config } from "@workagent/config";
import { toolFetch } from "@workagent/core";
import {
  requireBuild,
  requireManage,
  sensitiveMutation,
} from "../lib/guards.js";
const schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    baseUrl: z.url().max(2000),
    apiKey: z.string().min(1).max(4096).optional(),
    enabled: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
const projection =
  'id,name,model,base_url AS "baseUrl",enabled,is_default AS "isDefault",last_checked_at AS "lastCheckedAt",last_check_ok AS "lastCheckOk"';
export async function modelRoutes(app: FastifyInstance) {
  app.get("/models", async (request) => {
    requireBuild(request.user);
    return {
      items: await query(
        `SELECT ${projection} FROM model_connection WHERE org_id=$1 ORDER BY is_default DESC,name`,
        [request.user.orgId],
      ),
      allowedHosts: config.toolAllowedHosts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: method === "POST" ? "/models" : "/models/:id",
      handler: async (request, reply) => {
        const input = schema.parse(request.body);
        const id =
          method === "PUT"
            ? z.object({ id: z.string().uuid() }).parse(request.params).id
            : null;
        const url = new URL(input.baseUrl);
        const managedHost = await one(
          "SELECT id FROM gateway_upstream WHERE hostname=$1 AND enabled AND purpose IN ('model','both')",
          [url.hostname],
        );
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !(
            config.toolAllowedHosts
              .split(",")
              .map((s) => s.trim())
              .includes(url.hostname) || managedHost
          ) ||
          (url.port && url.port !== "443") ||
          url.search ||
          url.hash
        )
          throw badRequest(
            "模型地址必须为运维允许的 HTTPS 主机，不可带认证或查询参数",
          );
        return sensitiveMutation(request.user, "manage", async (c) => {
          const old = id
            ? (
                await c.query<{ api_key_encrypted: string }>(
                  "SELECT api_key_encrypted FROM model_connection WHERE id=$1 AND org_id=$2 FOR UPDATE",
                  [id, request.user.orgId],
                )
              ).rows[0]
            : null;
          if (id && !old) throw notFound();
          if (!old && !input.apiKey) throw badRequest("首次保存需要密钥");
          if (input.isDefault && input.enabled)
            await c.query(
              "UPDATE model_connection SET is_default=false WHERE org_id=$1",
              [request.user.orgId],
            );
          const encrypted = input.apiKey
            ? encryptSecret(input.apiKey)
            : old!.api_key_encrypted;
          let row;
          try {
            row = id
              ? (
                  await c.query(
                    `UPDATE model_connection SET name=$3,model=$4,base_url=$5,api_key_encrypted=$6,enabled=$7,is_default=$8,last_checked_at=NULL,last_check_ok=NULL,updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING ${projection}`,
                    [
                      id,
                      request.user.orgId,
                      input.name,
                      input.model,
                      input.baseUrl,
                      encrypted,
                      input.enabled,
                      input.isDefault,
                    ],
                  )
                ).rows[0]
              : (
                  await c.query(
                    `INSERT INTO model_connection(org_id,name,model,base_url,api_key_encrypted,enabled,is_default) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${projection}`,
                    [
                      request.user.orgId,
                      input.name,
                      input.model,
                      input.baseUrl,
                      encrypted,
                      input.enabled,
                      input.isDefault,
                    ],
                  )
                ).rows[0];
          } catch (e) {
            if ((e as { code?: string }).code === "23505")
              throw conflict("模型名称或模型标识已存在");
            throw e;
          }
          await c.query(
            "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'model.save','model',$3,$4)",
            [
              request.user.orgId,
              request.user.id,
              row.id,
              JSON.stringify({
                name: input.name,
                model: input.model,
                enabled: input.enabled,
              }),
            ],
          );
          if (!id) reply.code(201);
          return { item: row };
        });
      },
    });
  app.post("/models/:id/check", async (request) => {
    requireManage(request.user);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await one<{ base_url: string; api_key_encrypted: string }>(
      "SELECT base_url,api_key_encrypted FROM model_connection WHERE id=$1 AND org_id=$2",
      [id, request.user.orgId],
    );
    if (!row) throw notFound();
    let ok = false;
    let status: number | null = null;
    try {
      const response = await toolFetch(
        (row.base_url.endsWith("/")
          ? row.base_url.slice(0, -1)
          : row.base_url) + "/models",
        {
          headers: {
            authorization: "Bearer " + decryptSecret(row.api_key_encrypted),
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      status = response.status;
      ok = response.ok;
      await response.body?.cancel();
    } catch {}
    return sensitiveMutation(request.user, "manage", async (c) => {
      await c.query(
        "UPDATE model_connection SET last_checked_at=now(),last_check_ok=$3 WHERE id=$1 AND org_id=$2",
        [id, request.user.orgId, ok],
      );
      await c.query(
        "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'model.check','model',$3,$4)",
        [
          request.user.orgId,
          request.user.id,
          id,
          JSON.stringify({ ok, status }),
        ],
      );
      return {
        ok,
        status,
        message: ok
          ? "供应商模型目录连接成功；具体模型执行需单独验证"
          : "连接未通过，请检查允许主机、密钥和供应商地址",
      };
    });
  });
}
