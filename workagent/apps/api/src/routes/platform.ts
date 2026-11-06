import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, query, tx } from "@workagent/db";
import {
  forbidden,
  hashPassword,
  conflict,
  notFound,
  randomToken,
} from "@workagent/core";
import {
  createTenantSchema,
  tenantConfigurationSchema,
  platformPaginationSchema,
  type PlatformOverview,
  type PlatformTenant,
  type PlatformTenantDetail,
} from "@workagent/contracts";

const projection = `o.id,o.name,o.slug,o.plan,o.industry,o.company_size AS "companySize",o.contact_phone AS "contactPhone",o.description,o.status,o.status_reason AS "statusReason",o.created_at AS "createdAt",
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
  app.get("/observability", async (request) => {
    const p = z
      .object({ hours: z.coerce.number().int().min(1).max(720).default(24) })
      .parse(request.query);
    if (
      !(await one("SELECT user_id FROM platform_admin WHERE user_id=$1", [
        request.user.id,
      ]))
    )
      throw forbidden();
    const totals = await one(
      "SELECT count(*)::int AS runs,count(*) FILTER(WHERE status='failed')::int AS failed,count(*) FILTER(WHERE status='timeout')::int AS timed_out,count(*) FILTER(WHERE status='succeeded')::int AS succeeded,count(*) FILTER(WHERE status IN ('queued','running','waiting_approval'))::int AS active FROM agent_run WHERE created_at>=now()-($1::int*interval '1 hour')",
      [p.hours],
    );
    const daily = await query(
      "SELECT date_trunc('hour',created_at) AS hour,count(*)::int AS runs,count(*) FILTER(WHERE status='failed')::int AS failed FROM agent_run WHERE created_at>=now()-($1::int*interval '1 hour') GROUP BY 1 ORDER BY 1",
      [p.hours],
    );
    const tenants = await query(
      "SELECT o.status,count(*)::int AS count FROM org o GROUP BY o.status ORDER BY o.status",
    );
    return {
      hours: p.hours,
      totals,
      byHour: daily,
      tenants,
      generatedAt: new Date().toISOString(),
    };
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
            "INSERT INTO org(name,slug,plan,industry,company_size,contact_phone,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              input.name,
              input.slug,
              input.plan,
              input.industry,
              input.companySize,
              input.contactPhone,
              input.description,
            ],
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
        "UPDATE org SET name=$2,plan=$3,industry=$4,company_size=$5,contact_phone=$6,description=$7 WHERE id=$1 RETURNING id,name,slug,plan",
        [
          id,
          input.name,
          input.plan,
          input.industry,
          input.companySize,
          input.contactPhone,
          input.description,
        ],
      );
      if (!result.rowCount) throw notFound("租户不存在");
      await c.query(
        "INSERT INTO platform_audit(user_id,action,org_id,metadata) VALUES($1,'tenant.configure',$2,$3)",
        [request.user.id, id, JSON.stringify(input)],
      );
      return { tenant: result.rows[0] };
    });
  });
  app.post("/tenants/:id/reset-admin-password", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { confirmSlug } = z
      .object({ confirmSlug: z.string() })
      .strict()
      .parse(request.body);
    const password = randomToken(24);
    const passwordHash = await hashPassword(password);
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
      const org = (
        await c.query<{ slug: string }>(
          "SELECT slug FROM org WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!org) throw notFound();
      if (org.slug !== confirmSlug) throw conflict("请确认企业标识");
      const owner = (
        await c.query<{ id: string; email: string }>(
          "SELECT u.id,u.email FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.org_id=$1 AND m.role='owner' AND m.status='active' ORDER BY m.created_at LIMIT 1 FOR UPDATE OF u",
          [id],
        )
      ).rows[0];
      if (!owner) throw notFound("没有有效负责人");
      if (
        (
          await c.query("SELECT user_id FROM platform_admin WHERE user_id=$1", [
            owner.id,
          ])
        ).rowCount
      )
        throw conflict("独立平台身份不可在企业管理中重置");
      if (
        (
          await c.query(
            "SELECT org_id FROM membership WHERE user_id=$1 AND org_id<>$2 AND status='active'",
            [owner.id, id],
          )
        ).rowCount
      )
        throw conflict("负责人属于多个企业，请使用账号级凭据恢复");
      await c.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
        owner.id,
        passwordHash,
      ]);
      await c.query("DELETE FROM session WHERE user_id=$1", [owner.id]);
      await c.query(
        "INSERT INTO platform_audit(user_id,org_id,action,metadata) VALUES($1,$2,'tenant.reset_admin_password',$3)",
        [request.user.id, id, JSON.stringify({ ownerId: owner.id })],
      );
      return { email: owner.email, password };
    });
  });
  app.post("/tenants/:id/status", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z
      .object({
        status: z.enum(["active", "suspended", "archived"]),
        reason: z.string().trim().min(5).max(1000),
        confirmSlug: z.string(),
      })
      .strict()
      .parse(request.body);
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
      const tenant = (
        await c.query<{ slug: string; status: string }>(
          "SELECT slug,status FROM org WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!tenant) throw notFound("租户不存在");
      if (tenant.slug !== input.confirmSlug)
        throw conflict("请填写企业标识确认操作");
      if (tenant.status === input.status) throw conflict("企业已处于该状态");
      await c.query(
        "UPDATE org SET status=$2,status_reason=$3,status_changed_at=now() WHERE id=$1",
        [id, input.status, input.reason],
      );
      if (input.status !== "active") {
        await c.query("DELETE FROM session WHERE org_id=$1", [id]);
        await c.query(
          "UPDATE personal_automation SET status='paused' WHERE org_id=$1 AND status='active'",
          [id],
        );
        await c.query(
          "UPDATE agent_run SET status='canceled',finished_at=now() WHERE org_id=$1 AND status IN ('queued','running','waiting_approval')",
          [id],
        );
      }
      await c.query(
        "INSERT INTO platform_audit(user_id,org_id,action,metadata) VALUES($1,$2,'tenant.status',$3)",
        [
          request.user.id,
          id,
          JSON.stringify({ from: tenant.status, ...input }),
        ],
      );
      return { ok: true };
    });
  });
  app.get("/audit", async (request) => {
    const p = platformPaginationSchema.parse(request.query);
    const filter =
      "strpos(lower(a.action||coalesce(a.metadata::text,'')),lower($1))>0";
    const items = await query(
      `SELECT a.id,a.user_id AS "userId",u.email AS "userEmail",a.action,a.org_id AS "orgId",a.metadata,a.created_at AS "createdAt" FROM platform_audit a JOIN app_user u ON u.id=a.user_id WHERE ${filter} ORDER BY a.created_at DESC,a.id LIMIT $2 OFFSET $3`,
      [p.search, p.pageSize, (p.page - 1) * p.pageSize],
    );
    const total = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM platform_audit a WHERE ${filter}`,
      [p.search],
    );
    return { items, total: total!.count };
  });
}
