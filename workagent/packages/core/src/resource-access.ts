import type { PoolClient } from "pg";
import type { AuthUser } from "./auth.js";
import { canOperate } from "./auth.js";
import { one } from "@workagent/db";
import { notFound, forbidden } from "./errors.js";

/** Project association always takes precedence over enterprise run ownership/roles. */
export function runAccessSql(
  actor: string,
  operate: string,
  alias = "r",
  manage: boolean | "write" = false,
): string {
  return `((NOT EXISTS(SELECT 1 FROM agent private_agent WHERE private_agent.id=${alias}.agent_id AND private_agent.org_id=${alias}.org_id AND private_agent.personal_owner_id IS NOT NULL AND private_agent.personal_owner_id<>${actor}))
    AND NOT EXISTS(SELECT 1 FROM project private_project WHERE private_project.id=${alias}.project_id AND private_project.org_id=${alias}.org_id AND private_project.is_default AND (private_project.created_by<>${actor} OR ${alias}.user_id<>${actor}))
    AND (CASE WHEN ${alias}.project_id IS NOT NULL THEN
    EXISTS(SELECT 1 FROM project_member pm JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id WHERE pm.project_id=${alias}.project_id AND pm.org_id=${alias}.org_id AND pm.user_id=${actor} AND m.status='active' ${manage === true ? "AND pm.role='manager'" : manage === "write" ? `AND (pm.role='manager' OR (pm.role='contributor' AND EXISTS (SELECT 1 FROM project_task_attempt pa JOIN project_task pt ON pt.id=pa.task_id AND pt.org_id=pa.org_id AND pt.project_id=pa.project_id WHERE pa.run_id=${alias}.id AND pa.org_id=${alias}.org_id AND pt.assignee_id=${actor})))` : ""})
    ELSE (${alias}.user_id=${actor} OR (${operate} AND NOT EXISTS(SELECT 1 FROM agent personal WHERE personal.id=${alias}.agent_id AND personal.personal_owner_id IS NOT NULL))) END))`;
}
export async function requireRunAccess(
  u: AuthUser,
  runId: string,
  manage: boolean | "write" = false,
  client?: PoolClient,
) {
  if (client) {
    await client.query(
      "SELECT p.id FROM project p JOIN agent_run r ON r.project_id=p.id AND r.org_id=p.org_id WHERE r.id=$1 AND r.org_id=$2 FOR UPDATE OF p",
      [runId, u.orgId],
    );
    const live = (
      await client.query<{ role: AuthUser["role"] }>(
        "SELECT role FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
        [u.orgId, u.id],
      )
    ).rows[0];
    if (!live) throw notFound();
    u = { ...u, role: live.role };
    await client.query(
      "SELECT pm.user_id FROM project_member pm JOIN agent_run r ON r.project_id=pm.project_id AND r.org_id=pm.org_id WHERE r.id=$1 AND pm.user_id=$2 FOR SHARE OF pm",
      [runId, u.id],
    );
  }
  const localOne = client
    ? async <T>(sql: string, params: unknown[]) =>
        (await client.query(sql, params)).rows[0] as T | undefined
    : one;
  const row = await localOne<{ id: string }>(
    `SELECT r.id FROM agent_run r WHERE r.id=$1 AND r.org_id=$2 AND ${runAccessSql("$3", "$4", "r", manage)}`,
    [runId, u.orgId, u.id, canOperate(u)],
  );
  if (!row) throw notFound();
  if (client && manage === true && !canOperate(u)) {
    const project = await client.query(
      "SELECT project_id FROM agent_run WHERE id=$1 AND org_id=$2",
      [runId, u.orgId],
    );
    if (!project.rows[0]?.project_id) throw forbidden();
  }
}
