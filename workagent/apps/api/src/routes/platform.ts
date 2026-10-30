import type { FastifyInstance } from "fastify";
import { one, query, tx } from "@workagent/db";
import { forbidden, hashPassword, conflict, notFound } from "@workagent/core";
import {
  createTenantSchema,
  tenantConfigurationSchema,
  platformPaginationSchema,
  type PlatformOverview,
  type PlatformTenant,
  type PlatformTenantDetail,
} from "@workagent/contracts";

const projection = `o.id,o.name,o.slug,o.plan,o.created_at AS "createdAt",
 (SELECT count(*)::int FROM membership m WHERE m.org_id=o.id AND m.status='active') AS "activeMemberCount"`;
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    if (
      !(await one("SELECT user_id FROM platform_admin WHERE user_id=$1", [
        request.user.id,
      ]))
    )
      throw forbidden("需要独立的平台管理员授权");
  });
  app.get("/me", async (request) => ({
    userId: request.user.id,
    platformAdmin: true,
  }));
  app.get("/overview", async (): Promise<PlatformOverview> => {
    const row = await one<{ tenants: number; members: number }>(
      `SELECT (SELECT count(*)::int FROM org) AS tenants,(SELECT count(*)::int FROM membership WHERE status='active') AS members`,
    );
    return { tenantCount: row!.tenants, activeMemberCount: row!.members };
  });
  app.get("/tenants", async (request) => {
    const p = platformPaginationSchema.parse(request.query);
    // Literal keyword matching; wildcard characters do not broaden results.
    const keyword = `%${p.search.replace(/[\\%_]/g, "\\$&")}%`;
    const where = `o.name ILIKE $1 OR o.slug ILIKE $1`;
    const total = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM org o WHERE ${where}`,
      [keyword],
    );
    const items = await query<PlatformTenant>(
      `SELECT ${projection} FROM org o WHERE ${where} ORDER BY o.created_at DESC,o.id LIMIT $2 OFFSET $3`,
      [keyword, p.pageSize, (p.page - 1) * p.pageSize],
    );
    return { items, total: total!.count, page: p.page, pageSize: p.pageSize };
  });
  app.get("/tenants/:id", async (request) => {
    const { id } = request.params as { id: string };
    const tenant = await one<PlatformTenantDetail>(
      `SELECT ${projection},
      (SELECT count(*)::int FROM agent WHERE org_id=o.id AND status<>'archived') AS "agentCount",
      (SELECT count(*)::int FROM agent_run WHERE org_id=o.id) AS "runCount",
      ((SELECT coalesce(sum(a.size),0) FROM artifact a JOIN agent_run r ON r.id=a.run_id WHERE r.org_id=o.id) + (SELECT coalesce(sum(d.size),0) FROM document d WHERE d.org_id=o.id))::float8 AS "storageBytes",
      (SELECT coalesce(sum(cost_usd),0)::float8 FROM usage_record WHERE org_id=o.id) AS "costUsd"
      FROM org o WHERE o.id=$1`,
      [id],
    );
    if (!tenant) throw notFound("租户不存在");
    return { tenant };
  });
  app.post("/tenants", async (request, reply) => {
    const input = createTenantSchema.parse(request.body);
    const passwordHash = await hashPassword(input.ownerPassword);
    try {
      const result = await tx(async (c) => {
        // Grant cannot be revoked between authorization, writes and audit commit.
        if (
          !(
            await c.query(
              "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
              [request.user.id],
            )
          ).rowCount
        )
          throw forbidden();
        const org = (
          await c.query<{ id: string }>(
            "INSERT INTO org(name,slug,plan) VALUES($1,$2,$3) RETURNING id",
            [input.name, input.slug, input.plan],
          )
        ).rows[0]!;
        // Existing identities are always rejected, never silently attached or rotated.
        const owner = (
          await c.query<{ id: string }>(
            "INSERT INTO app_user(email,name,password_hash) VALUES($1,$2,$3) RETURNING id",
            [input.ownerEmail, input.ownerName, passwordHash],
          )
        ).rows[0]!;
        await c.query(
          "INSERT INTO membership(org_id,user_id,role,status) VALUES($1,$2,'owner','active')",
          [org.id, owner.id],
        );
        await c.query(
          "INSERT INTO quota(org_id,scope,scope_id) VALUES($1,'org',$1)",
          [org.id],
        );
        await c.query(
          "INSERT INTO platform_audit(user_id,action,org_id,metadata) VALUES($1,'tenant.create',$2,$3)",
          [
            request.user.id,
            org.id,
            JSON.stringify({
              name: input.name,
              slug: input.slug,
              plan: input.plan,
              ownerId: owner.id,
            }),
          ],
        );
        return { orgId: org.id, ownerId: owner.id };
      });
      reply.code(201);
      return result;
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw conflict("企业标识或初始负责人邮箱已存在，请使用新的标识与邮箱");
      throw e;
    }
  });
  app.patch("/tenants/:id", async (request) => {
    const input = tenantConfigurationSchema.parse(request.body);
    const { id } = request.params as { id: string };
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
      const result = await c.query(
        "UPDATE org SET name=$2,plan=$3 WHERE id=$1 RETURNING id,name,slug,plan",
        [id, input.name, input.plan],
      );
      if (!result.rowCount) throw notFound("租户不存在");
      await c.query(
        "INSERT INTO platform_audit(user_id,action,org_id,metadata) VALUES($1,'tenant.configure',$2,$3)",
        [request.user.id, id, JSON.stringify(input)],
      );
      return { tenant: result.rows[0] };
    });
  });
  app.get("/audit", async (request) => {
    const p = platformPaginationSchema.parse(request.query);
    const items = await query(
      `SELECT id,user_id AS "userId",action,org_id AS "orgId",metadata,created_at AS "createdAt" FROM platform_audit ORDER BY created_at DESC,id LIMIT $1 OFFSET $2`,
      [p.pageSize, (p.page - 1) * p.pageSize],
    );
    const total = await one<{ count: number }>(
      "SELECT count(*)::int AS count FROM platform_audit",
    );
    return { items, total: total!.count };
  });
}
