import type { FastifyInstance } from "fastify";
import { one, query } from "@workagent/db";
import { ensureDefaultProject, savePersonalAssistant,modelReady } from "@workagent/core";
import { config } from "@workagent/config";
import { personalProfileSchema } from "@workagent/contracts";
export async function personalRoutes(app: FastifyInstance) {
  app.get("/personal-assistant", async (request) => {
    const row = await one(
      'SELECT id,name,description,status,visibility,personal_profile AS profile,published_version AS "activeVersion",current_revision_id AS "currentRevisionId" FROM agent WHERE org_id=$1 AND personal_owner_id=$2',
      [request.user.orgId, request.user.id],
    );
    if (row) await ensureDefaultProject(request.user);
    const ready=await modelReady(request.user.orgId,config.modelName);
    return {
      agent: row ? { ...row, profile: personalProfileSchema.parse(row.profile) } : null,
      readiness: {
        definitionReady: !!row,
        modelConfigured: ready,
        canExecute: ready || config.useMockModel,
        policy: "personal-text-only-v1",
      },
    };
  });
  app.post("/personal-assistant", async (request) =>
    savePersonalAssistant(request.user, request.body, true),
  );
  app.put("/personal-assistant", async (request) =>
    savePersonalAssistant(request.user, request.body, false),
  );
  app.get("/personal-usage", async (request) => {
    const params = [request.user.orgId, request.user.id];
    const summary = await one(
      `SELECT count(DISTINCT run_id)::int AS runs, COALESCE(sum(input_tokens),0)::float8 AS "inputTokens",COALESCE(sum(output_tokens),0)::float8 AS "outputTokens",COALESCE(sum(cost_usd),0)::float8 AS "costUsd" FROM usage_record WHERE org_id=$1 AND user_id=$2 AND created_at>=now()-interval '30 days'`,
      params,
    );
    const items = await query(
      `SELECT u.run_id AS "runId",u.kind,u.input_tokens AS "inputTokens",u.output_tokens AS "outputTokens",u.cost_usd AS "costUsd",u.created_at AS "createdAt" FROM usage_record u WHERE u.org_id=$1 AND u.user_id=$2 AND u.created_at>=now()-interval '30 days' ORDER BY u.created_at DESC LIMIT 100`,
      params,
    );
    return { summary, items };
  });
  app.get("/personal-growth", async (request) => {
    const agent = await one<{ id: string; published_version: number | null }>(
      "SELECT id,published_version FROM agent WHERE org_id=$1 AND personal_owner_id=$2",
      [request.user.orgId, request.user.id],
    );
    if (!agent) return { summary: { revisions: 0, runs: 0, succeeded: 0, failed: 0 }, items: [] };
    const summary = await one(
      `SELECT (SELECT count(*)::int FROM agent_revision WHERE agent_id=$3 AND status IN ('published','archived')) AS revisions,
       count(*)::int AS runs, count(*) FILTER (WHERE r.status='succeeded')::int AS succeeded,
       count(*) FILTER (WHERE r.status='failed')::int AS failed
       FROM agent_run r WHERE r.org_id=$1 AND r.user_id=$2 AND r.agent_id=$3 AND r.created_at>=now()-interval '30 days'`,
      [request.user.orgId, request.user.id, agent.id],
    );
    const items = await query(
      `SELECT id,status,created_at AS "createdAt",finished_at AS "finishedAt",left(input,180) AS summary
       FROM agent_run WHERE org_id=$1 AND user_id=$2 AND agent_id=$3
       ORDER BY created_at DESC LIMIT 20`,
      [request.user.orgId, request.user.id, agent.id],
    );
    return { summary: { ...summary, activeVersion: agent.published_version }, items };
  });
  app.get("/portal-content", async (request) => ({
    items: await query(
      `SELECT id,title,slug,summary,published_at AS "publishedAt",updated_at AS "updatedAt"
       FROM managed_content WHERE org_id=$1 AND status='published'
       ORDER BY published_at DESC LIMIT 100`,
      [request.user.orgId],
    ),
  }));
  app.get<{ Params: { id: string } }>("/portal-content/:id", async (request, reply) => {
    const item = await one(
      `SELECT id,title,slug,summary,body,published_at AS "publishedAt"
       FROM managed_content WHERE id=$1 AND org_id=$2 AND status='published'`,
      [request.params.id, request.user.orgId],
    );
    if (!item) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "内容不存在" } });
    return { item };
  });
}
