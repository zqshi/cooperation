import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, query, tx } from "@workagent/db";
import { forbidden, notFound, conflict } from "@workagent/core";
const image = z
  .object({
    name: z.string().trim().min(1).max(120),
    imageRef: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{1,499}$/),
    kind: z.enum(["agent", "tool", "browser"]),
    description: z.string().max(2000).default(""),
    enabled: z.boolean(),
  })
  .strict();
const profile = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["spec", "network", "config", "toggle"]),
    cpuMillis: z.number().int().min(100).max(64000),
    memoryMb: z.number().int().min(128).max(131072),
    timeoutSeconds: z.number().int().min(1).max(3600),
    allowedHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).max(100),
    environment: z.record(
      z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .refine(
          (v) => !/(SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)/.test(v),
          "敏感值应使用密钥管理",
        ),
      z.string().max(4096),
    ),
    enabled: z.boolean(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export async function runtimeRegistryRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    if (
      !(await one("SELECT user_id FROM platform_admin WHERE user_id=$1", [
        request.user.id,
      ]))
    )
      throw forbidden();
  });
  app.get("/runtime-images", async () => ({
    items: await query(
      'SELECT id,name,image_ref AS "imageRef",kind,description,enabled,updated_at AS "updatedAt" FROM runtime_image ORDER BY kind,name',
    ),
    executionProviderConfigured: false,
  }));
  app.get("/profiles", async () => ({
    items: await query(
      'SELECT id,name,kind,cpu_millis AS "cpuMillis",memory_mb AS "memoryMb",timeout_seconds AS "timeoutSeconds",allowed_hosts AS "allowedHosts",environment,enabled,version FROM runtime_profile ORDER BY kind,name',
    ),
  }));
  for (const resource of ["runtime-images", "profiles"] as const)
    for (const method of ["POST", "PUT"] as const)
      app.route({
        method,
        url: method === "POST" ? "/" + resource : "/" + resource + "/:id",
        handler: async (request, reply) => {
          const id =
            method === "PUT"
              ? z.object({ id: z.string().uuid() }).parse(request.params).id
              : null;
          const input =
            resource === "runtime-images"
              ? image.parse(request.body)
              : profile.parse(request.body);
          return tx(async (c) => {
            if (
              !(
                await c.query(
                  "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
                  [request.user.id],
                )
              ).rowCount
            )
              throw forbidden();
            let result;
            try {
              if (resource === "runtime-images") {
                const v = image.parse(input);
                result = id
                  ? await c.query(
                      "UPDATE runtime_image SET name=$2,image_ref=$3,kind=$4,description=$5,enabled=$6,updated_at=now() WHERE id=$1 RETURNING id",
                      [
                        id,
                        v.name,
                        v.imageRef,
                        v.kind,
                        v.description,
                        v.enabled,
                      ],
                    )
                  : await c.query(
                      "INSERT INTO runtime_image(name,image_ref,kind,description,enabled) VALUES($1,$2,$3,$4,$5) RETURNING id",
                      [v.name, v.imageRef, v.kind, v.description, v.enabled],
                    );
              } else {
                const v = profile.parse(input);
                if (id) {
                  const old = (
                    await c.query<{ version: number }>(
                      "SELECT version FROM runtime_profile WHERE id=$1 FOR UPDATE",
                      [id],
                    )
                  ).rows[0];
                  if (!old) throw notFound();
                  if (old.version !== v.expectedVersion)
                    throw conflict("配置已更新，请刷新");
                }
                result = id
                  ? await c.query(
                      "UPDATE runtime_profile SET name=$2,kind=$3,cpu_millis=$4,memory_mb=$5,timeout_seconds=$6,allowed_hosts=$7,environment=$8,enabled=$9,version=version+1,updated_at=now() WHERE id=$1 RETURNING id",
                      [
                        id,
                        v.name,
                        v.kind,
                        v.cpuMillis,
                        v.memoryMb,
                        v.timeoutSeconds,
                        v.allowedHosts,
                        JSON.stringify(v.environment),
                        v.enabled,
                      ],
                    )
                  : await c.query(
                      "INSERT INTO runtime_profile(name,kind,cpu_millis,memory_mb,timeout_seconds,allowed_hosts,environment,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
                      [
                        v.name,
                        v.kind,
                        v.cpuMillis,
                        v.memoryMb,
                        v.timeoutSeconds,
                        v.allowedHosts,
                        JSON.stringify(v.environment),
                        v.enabled,
                      ],
                    );
              }
            } catch (e) {
              if ((e as { code?: string }).code === "23505")
                throw conflict("名称已存在");
              throw e;
            }
            if (!result.rowCount) throw notFound();
            await c.query(
              "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,$2,$3)",
              [
                request.user.id,
                resource + ".save",
                JSON.stringify({
                  id: result.rows[0].id,
                  name: input.name,
                  kind: input.kind,
                  enabled: input.enabled,
                }),
              ],
            );
            if (!id) reply.code(201);
            return { id: result.rows[0].id };
          });
        },
      });
}
