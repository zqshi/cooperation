import { config } from "@workagent/config";
import type { FastifyInstance } from "fastify";
import { one, query } from "@workagent/db";
import { canOperate, canBuild, runAccessSql, forbidden } from "@workagent/core";
import { requireAudit, requireManage } from "../lib/guards.js";

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/execution-readiness", async () => ({
    modelConfigured: Boolean(config.modelApiKey),
    canExecute: Boolean(config.modelApiKey) || config.useMockModel,
  }));
  app.get("/tenant-home", async (request) => {
    const u = request.user;
    if (!["owner", "admin", "builder", "auditor"].includes(u.role))
      throw forbidden();
    const access = runAccessSql("$2", "$3");
    const params = [u.orgId, u.id, canOperate(u)];
    const runs = await one<{ runs: number; failed: number; pending: number }>(
      `SELECT count(*)::int AS runs,count(*) FILTER(WHERE r.status IN ('failed','timeout'))::int AS failed,
      (SELECT count(*)::int FROM approval ap JOIN agent_run r ON r.id=ap.run_id WHERE r.org_id=$1 AND ap.status='pending' AND ${access}) AS pending
      FROM agent_run r WHERE r.org_id=$1 AND ${access} AND r.created_at>=now()-interval '7 days'`,
      params,
    );
    const resources = await one<{
      agents: number;
      published: number;
      knowledge: number;
      channels: number;
      configured: number;
    }>(
      `SELECT
      (SELECT count(*)::int FROM agent WHERE org_id=$1 AND status<>'archived' AND (visibility<>'private' OR created_by=$2 OR $3)) AS agents,
      (SELECT count(*)::int FROM agent WHERE org_id=$1 AND status='published' AND (visibility<>'private' OR created_by=$2 OR $3)) AS published,
      (SELECT count(*)::int FROM knowledge_space WHERE org_id=$1) AS knowledge,
      (SELECT count(*)::int FROM channel_account WHERE org_id=$1) AS channels,
      (SELECT count(*)::int FROM channel_account WHERE org_id=$1 AND status='active' AND app_id IS NOT NULL AND app_secret_encrypted IS NOT NULL) AS configured`,
      [u.orgId, u.id, canBuild(u)],
    );
    const recent = await query(
      `SELECT r.id,r.status,a.name AS "agentName",r.created_at AS "createdAt" FROM agent_run r JOIN agent a ON a.id=r.agent_id AND a.org_id=r.org_id WHERE r.org_id=$1 AND ${access} ORDER BY r.created_at DESC,r.id LIMIT 8`,
      params,
    );
    return {
      portalOrigin: config.userPortalOrigin,
      counts: {
        agents: resources!.agents,
        published: resources!.published,
        knowledge: resources!.knowledge,
        channels: resources!.channels,
        ...runs,
      },
      readiness: {
        modelConfigured: Boolean(config.modelApiKey),
        publishedAgent: resources!.published > 0,
        configuredChannels: resources!.configured,
        verifiedChannels: null,
      },
      recent,
    };
  });
  app.get("/dashboard", async (request) => {
    requireAudit(request.user);
    const orgId = request.user.orgId;
    const [
      agents,
      published,
      runsToday,
      terminal7d,
      success7d,
      pending,
      costMonth,
      activeUsers,
    ] = await Promise.all([
      one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM agent WHERE org_id = $1 AND status <> 'archived'",
        [orgId],
      ),
      one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM agent WHERE org_id = $1 AND status = 'published'",
        [orgId],
      ),
      one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM agent_run WHERE org_id = $1 AND created_at >= date_trunc('day', now())",
        [orgId],
      ),
      one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM agent_run WHERE org_id = $1 AND status IN ('succeeded','failed','canceled','timeout') AND created_at >= now() - interval '7 days'",
        [orgId],
      ),
      one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM agent_run WHERE org_id = $1 AND status = 'succeeded' AND created_at >= now() - interval '7 days'",
        [orgId],
      ),
      one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM approval a JOIN agent_run r ON r.id = a.run_id WHERE r.org_id = $1 AND a.status = 'pending'",
        [orgId],
      ),
      one<{ total: string }>(
        "SELECT COALESCE(SUM(cost_usd),0)::text AS total FROM usage_record WHERE org_id = $1 AND created_at >= date_trunc('month', now())",
        [orgId],
      ),
      one<{ count: string }>(
        "SELECT COUNT(DISTINCT user_id)::text AS count FROM agent_run WHERE org_id = $1 AND created_at >= now() - interval '7 days'",
        [orgId],
      ),
    ]);

    const terminal = Number(terminal7d?.count ?? 0);
    return {
      stats: {
        agents: Number(agents?.count ?? 0),
        publishedAgents: Number(published?.count ?? 0),
        runsToday: Number(runsToday?.count ?? 0),
        successRate7d:
          terminal === 0 ? 0 : Number(success7d?.count ?? 0) / terminal,
        pendingApprovals: Number(pending?.count ?? 0),
        costMonthUsd: Number(costMonth?.total ?? 0),
        activeUsers7d: Number(activeUsers?.count ?? 0),
      },
    };
  });

  app.get("/audit", async (request) => {
    requireAudit(request.user);
    const { resourceType, action, limit } = request.query as {
      resourceType?: string;
      action?: string;
      limit?: string;
    };
    const params: unknown[] = [request.user.orgId];
    const conditions = ["a.org_id = $1"];
    if (resourceType) {
      params.push(resourceType);
      conditions.push(`a.resource_type = $${params.length}`);
    }
    if (action) {
      params.push(action);
      conditions.push(`a.action = $${params.length}`);
    }
    const pageSize = Math.min(200, Math.max(1, Number(limit ?? 100)));
    const rows = await query(
      `SELECT a.*, u.name AS actor_name
         FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY a.created_at DESC LIMIT ${pageSize}`,
      params,
    );
    return { items: rows, total: rows.length };
  });

  app.get("/usage", async (request) => {
    requireAudit(request.user);
    const { from, to } = request.query as { from?: string; to?: string };
    const fromDate =
      from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = to ?? new Date().toISOString();
    const [summary, byAgent, byDay] = await Promise.all([
      one<{
        cost: string;
        runs: string;
        input_tokens: string;
        output_tokens: string;
      }>(
        `SELECT COALESCE(SUM(cost_usd),0)::text AS cost,
                COUNT(DISTINCT run_id)::text AS runs,
                COALESCE(SUM(input_tokens),0)::text AS input_tokens,
                COALESCE(SUM(output_tokens),0)::text AS output_tokens
           FROM usage_record WHERE org_id = $1 AND created_at BETWEEN $2 AND $3`,
        [request.user.orgId, fromDate, toDate],
      ),
      query(
        `SELECT u.agent_id, a.name, COUNT(DISTINCT u.run_id)::int AS runs,
                COALESCE(SUM(u.cost_usd),0)::float8 AS cost_usd
           FROM usage_record u LEFT JOIN agent a ON a.id = u.agent_id
          WHERE u.org_id = $1 AND a.personal_owner_id IS NULL AND u.created_at BETWEEN $2 AND $3
          GROUP BY u.agent_id, a.name ORDER BY cost_usd DESC`,
        [request.user.orgId, fromDate, toDate],
      ),
      query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
                COUNT(DISTINCT run_id)::int AS runs,
                COALESCE(SUM(cost_usd),0)::float8 AS cost_usd
           FROM usage_record WHERE org_id = $1 AND created_at BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY 1`,
        [request.user.orgId, fromDate, toDate],
      ),
    ]);
    return {
      summary: {
        from: fromDate,
        to: toDate,
        totalCostUsd: Number(summary?.cost ?? 0),
        totalRuns: Number(summary?.runs ?? 0),
        totalInputTokens: Number(summary?.input_tokens ?? 0),
        totalOutputTokens: Number(summary?.output_tokens ?? 0),
        byAgent,
        byDay,
      },
    };
  });

  app.get("/quotas", async (request) => {
    requireManage(request.user);
    const rows = await query(
      "SELECT * FROM quota WHERE org_id = $1 ORDER BY scope, scope_id",
      [request.user.orgId],
    );
    return { items: rows, total: rows.length };
  });

  app.patch("/quotas/:id", async (request) => {
    requireManage(request.user);
    const { id } = request.params as { id: string };
    const input = request.body as {
      monthlyBudgetUsd?: number;
      monthlyRunLimit?: number;
    };
    const row = await one(
      `UPDATE quota
          SET monthly_budget_usd = COALESCE($2, monthly_budget_usd),
              monthly_run_limit = COALESCE($3, monthly_run_limit)
        WHERE id = $1 AND org_id = $4
        RETURNING *`,
      [
        id,
        input.monthlyBudgetUsd ?? null,
        input.monthlyRunLimit ?? null,
        request.user.orgId,
      ],
    );
    return { quota: row };
  });
}
