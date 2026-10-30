import type { FastifyInstance } from "fastify";
import { one, query } from "@workagent/db";
import { ensureDefaultProject, savePersonalAssistant } from "@workagent/core";
import { config } from "@workagent/config";
export async function personalRoutes(app: FastifyInstance) {
  app.get("/personal-assistant", async (request) => {
    const agent = await one(
      'SELECT id,name,description,status,visibility,personal_profile AS profile,published_version AS "activeVersion",current_revision_id AS "currentRevisionId" FROM agent WHERE org_id=$1 AND personal_owner_id=$2',
      [request.user.orgId, request.user.id],
    );
    if (agent) await ensureDefaultProject(request.user);
    return {
      agent,
      readiness: {
        definitionReady: !!agent,
        modelConfigured: !!config.modelApiKey,
        canExecute: !!config.modelApiKey || config.useMockModel,
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
}
