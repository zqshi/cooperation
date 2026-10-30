import { sensitiveMutation, transactionOne } from "../lib/guards.js";
import { platformLogin, PLATFORM_COOKIE, sha256 } from "@workagent/core";
import type { FastifyInstance } from "fastify";
import {
  inviteMemberSchema,
  loginSchema,
  updateMemberSchema,
} from "@workagent/contracts";
import {
  audit as baseAudit,
  notFound,
  forbidden,
  conflict,
  canManage,
  hashPassword,
  login,
  logout,
  randomToken,
  requireRole,
  SESSION_COOKIE,
} from "@workagent/core";
import { config } from "@workagent/config";
import { one, query, tx } from "@workagent/db";

const audit = baseAudit;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/platform-auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const token = await platformLogin(input.email, input.password);
      reply.setCookie(PLATFORM_COOKIE, token, {
        path: "/v1",
        httpOnly: true,
        sameSite: "strict",
        secure: config.isProd,
        maxAge: 3600,
      });
      return { ok: true };
    },
  );
  app.post("/platform-auth/logout", async (request, reply) => {
    const token =
      request.cookies[PLATFORM_COOKIE] ??
      request.headers.authorization?.replace(/^Bearer /, "");
    if (token)
      await tx(async (c) => {
        await c.query("DELETE FROM platform_session WHERE token_hash=$1", [
          sha256(token),
        ]);
        await c.query(
          "INSERT INTO platform_audit(user_id,action) VALUES($1,'platform.logout')",
          [request.user.id],
        );
      });
    reply.clearCookie(PLATFORM_COOKIE, { path: "/v1" });
    return { ok: true };
  });
  app.post("/auth/revoke-all", async (request) => {
    await query("DELETE FROM session WHERE user_id=$1", [request.user.id]);
    return { ok: true };
  });
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const result = await login(input.email, input.password);
      reply.setCookie(SESSION_COOKIE, result.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProd,
        maxAge: 7 * 24 * 60 * 60,
      });
      await audit({
        orgId: result.user.orgId,
        actorId: result.user.id,
        action: "auth.login",
        resourceType: "session",
        ip: request.ip,
      });
      return { user: result.user };
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const token =
      request.cookies[SESSION_COOKIE] ??
      request.headers.authorization?.replace(/^Bearer /, "");
    await logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (request) => ({ user: request.user }));

  app.get("/org", async (request) => {
    const org = await one<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      created_at: string;
    }>("SELECT id, name, slug, plan, created_at FROM org WHERE id = $1", [
      request.user.orgId,
    ]);
    return {
      org: org
        ? {
            id: org.id,
            name: org.name,
            slug: org.slug,
            plan: org.plan,
            createdAt: org.created_at,
          }
        : null,
    };
  });

  app.get("/members", async (request) => {
    requireRole(request.user, ["owner", "admin"]);
    const rows = await query<{
      id: string;
      user_id: string;
      email: string;
      name: string;
      role: string;
      status: string;
      created_at: string;
    }>(
      `SELECT m.id, m.user_id, u.email, u.name, m.role, m.status, m.created_at
         FROM membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.org_id = $1
        ORDER BY m.created_at`,
      [request.user.orgId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
      })),
      total: rows.length,
    };
  });

  app.post("/members", async (request, reply) => {
    return sensitiveMutation(request.user, "manage", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireRole(request.user, ["owner", "admin"]);
      const input = inviteMemberSchema.parse(request.body);
      const email = input.email.toLowerCase();

      let user = await one<{ id: string }>(
        "SELECT id FROM app_user WHERE email = $1",
        [email],
      );
      let temporaryPassword: string | undefined;
      if (!user) {
        temporaryPassword = input.password ?? randomToken(9);
        const passwordHash = await hashPassword(temporaryPassword);
        user = await one<{ id: string }>(
          "INSERT INTO app_user (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
          [email, input.name, passwordHash],
        );
      }
      if (!user) throw new Error("failed to create user");

      const existing = await one<{ id: string }>(
        "SELECT id FROM membership WHERE org_id = $1 AND user_id = $2",
        [request.user.orgId, user.id],
      );
      if (existing) {
        throw conflict("该成员已在组织中");
      }

      const membership = await one<{
        id: string;
        role: string;
        status: string;
        created_at: string;
      }>(
        `INSERT INTO membership (org_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, role, status, created_at`,
        [request.user.orgId, user.id, input.role],
      );

      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "member.create",
        resourceType: "member",
        resourceId: membership?.id,
        metadata: { email, role: input.role },
        ip: request.ip,
      });

      return {
        member: {
          id: membership?.id,
          email,
          name: input.name,
          role: input.role,
          status: "active",
          createdAt: membership?.created_at,
        },
        temporaryPassword,
      };
    });
  });

  app.patch("/members/:id", async (request) => {
    requireRole(request.user, ["owner", "admin"]);
    const { id } = request.params as { id: string };
    const input = updateMemberSchema.parse(request.body);

    return tx(async (client) => {
      const query = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await client.query(sql, params)).rows as T[];
      const one = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await query<T>(sql, params))[0] ?? null;
      await client.query("SELECT id FROM org WHERE id=$1 FOR UPDATE", [
        request.user.orgId,
      ]);
      const actor = await one<{ role: string }>(
        "SELECT role FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
        [request.user.orgId, request.user.id],
      );
      if (!actor || !["owner", "admin"].includes(actor.role)) throw forbidden();
      const membership = await one<{ user_id: string; role: string }>(
        "SELECT user_id, role FROM membership WHERE id = $1 AND org_id = $2",
        [id, request.user.orgId],
      );
      if (!membership) {
        throw notFound("成员不存在");
      }
      if (
        actor.role !== "owner" &&
        (membership.role === "owner" || input.role === "owner")
      )
        throw forbidden("Only owner may change ownership");

      if (
        membership.role === "owner" &&
        ((input.role && input.role !== "owner") || input.status === "disabled")
      ) {
        const owners = await one<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM membership WHERE org_id = $1 AND role = 'owner' AND status = 'active'",
          [request.user.orgId],
        );
        if (Number(owners?.count ?? 0) <= 1) {
          throw conflict("组织至少需要保留一个 owner");
        }
      }

      const updated = await one<{
        id: string;
        role: string;
        status: string;
        email: string;
        name: string;
      }>(
        `UPDATE membership m
          SET role = COALESCE($2, m.role), status = COALESCE($3, m.status)
        WHERE m.id = $1 AND m.org_id = $4
        RETURNING m.id, m.role, m.status,
                  (SELECT email FROM app_user WHERE id = m.user_id) AS email,
                  (SELECT name FROM app_user WHERE id = m.user_id) AS name`,
        [id, input.role ?? null, input.status ?? null, request.user.orgId],
      );

      await audit(
        {
          orgId: request.user.orgId,
          actorId: request.user.id,
          action: "member.update",
          resourceType: "member",
          resourceId: id,
          metadata: input,
          ip: request.ip,
        },
        client,
      );

      if (input.status === "disabled")
        await client.query(
          "DELETE FROM session WHERE org_id=$1 AND user_id=$2",
          [request.user.orgId, membership.user_id],
        );
      return { member: updated };
    });
  });
}
