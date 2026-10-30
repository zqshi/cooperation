import type { PoolClient } from "pg";
import { one, query, tx } from "@workagent/db";
import type { Project } from "@workagent/contracts";
import { forbidden, notFound } from "./errors.js";
import type { AuthUser } from "./auth.js";

/** Same transaction as provisioning, or a real first-use bootstrap for existing users. */
export async function ensureDefaultProject(
  user: AuthUser,
  client?: PoolClient,
): Promise<Project> {
  const ensure = async (c: PoolClient) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,14))", [
      JSON.stringify([user.orgId, user.id]),
    ]);
    const live = await c.query(
      "SELECT user_id FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
      [user.orgId, user.id],
    );
    if (!live.rowCount) throw notFound();
    let p = (
      await c.query<Project>(
        "SELECT * FROM project WHERE org_id=$1 AND created_by=$2 AND is_default",
        [user.orgId, user.id],
      )
    ).rows[0];
    if (!p) {
      p = (
        await c.query<Project>(
          "INSERT INTO project(org_id,created_by,name,description,is_default) VALUES($1,$2,'默认项目','仅自己可见；规划任务与本人未关联任务的执行、审批及产物。',true) RETURNING *",
          [user.orgId, user.id],
        )
      ).rows[0]!;
      await c.query(
        "INSERT INTO project_member(org_id,project_id,user_id,role) VALUES($1,$2,$3,'manager')",
        [user.orgId, p.id, user.id],
      );
      await c.query(
        "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id) VALUES($1,$2,'project.default.create','project',$3)",
        [user.orgId, user.id, p.id],
      );
    }
    return { ...p, role: "manager" as const };
  };
  return client ? ensure(client) : tx(ensure);
}

export async function requireProjectAccess(
  user: AuthUser,
  id: string,
  manage = false,
) {
  const project = await one<Project>(
    `SELECT p.*, pm.role FROM project p
     JOIN project_member pm ON pm.project_id=p.id AND pm.org_id=p.org_id
     JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id AND m.status='active'
     WHERE p.id=$1 AND p.org_id=$2 AND pm.user_id=$3 AND (NOT p.is_default OR p.created_by=$3)`,
    [id, user.orgId, user.id],
  );
  if (!project) throw notFound("项目不存在或未加入");
  if (manage && project.role !== "manager") throw forbidden("需要项目管理权限");
  return project;
}

export async function listProjects(user: AuthUser) {
  await ensureDefaultProject(user);
  return query<Project>(
    `SELECT p.*, pm.role FROM project p
    JOIN project_member pm ON pm.project_id=p.id AND pm.org_id=p.org_id
    JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id AND m.status='active'
    WHERE p.org_id=$1 AND pm.user_id=$2 AND (NOT p.is_default OR p.created_by=$2) ORDER BY p.is_default DESC,p.created_at DESC,p.id`,
    [user.orgId, user.id],
  );
}

export async function createProject(
  user: AuthUser,
  input: { name: string; description: string },
) {
  if (user.role === "auditor") throw forbidden();
  return tx(async (client) => {
    const member = await client.query(
      `SELECT user_id FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE`,
      [user.orgId, user.id],
    );
    if (!member.rowCount) throw forbidden("企业成员身份不可用");
    const result = await client.query<Project>(
      `INSERT INTO project(org_id,name,description,created_by) VALUES($1,$2,$3,$4) RETURNING *`,
      [user.orgId, input.name, input.description, user.id],
    );
    const project = result.rows[0]!;
    await client.query(
      `INSERT INTO project_member(org_id,project_id,user_id,role) VALUES($1,$2,$3,'manager')`,
      [user.orgId, project.id, user.id],
    );
    return { ...project, role: "manager" as const };
  });
}

export async function listProjectMembers(user: AuthUser, id: string) {
  await requireProjectAccess(user, id);
  return query(
    `SELECT pm.user_id,pm.role,u.name,u.email FROM project_member pm
    JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id
    JOIN app_user u ON u.id=pm.user_id
    WHERE pm.org_id=$1 AND pm.project_id=$2 AND m.status='active'`,
    [user.orgId, id],
  );
}

export async function listProjectCandidates(user: AuthUser, id: string) {
  const project = await requireProjectAccess(user, id, true);
  if (project.is_default) return [];
  return query(
    `SELECT u.id,u.name,u.email FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.org_id=$1 AND m.status='active'`,
    [user.orgId],
  );
}

export async function setProjectMember(
  user: AuthUser,
  id: string,
  input: { userId: string; role: "manager" | "contributor" | "viewer" },
) {
  await tx(async (client) => {
    const project = await requireProjectAccess(user, id, true);
    if (project.is_default) throw forbidden("默认项目不可共享或修改成员");
    await client.query(
      "SELECT id FROM project WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [user.orgId, id],
    );
    const owner = await client.query(
      "SELECT id FROM project WHERE org_id=$1 AND id=$2 AND created_by=$3",
      [user.orgId, id, input.userId],
    );
    if (owner.rowCount && input.role !== "manager")
      throw forbidden("所有者必须保留管理权限");
    // Lock the actor's role and both org memberships until the assignment commits.
    const access = await client.query<{ role: string }>(
      `SELECT pm.role FROM project_member pm
      JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id
      WHERE pm.org_id=$1 AND pm.project_id=$2 AND pm.user_id=$3 AND m.status='active'
      FOR SHARE OF pm,m`,
      [user.orgId, id, user.id],
    );
    if (!access.rows[0]) throw notFound("项目不存在或未加入");
    if (access.rows[0].role !== "manager") throw forbidden("需要项目管理权限");
    if (input.userId === user.id) throw forbidden("不能修改自己的项目权限");
    const member = await client.query(
      `SELECT user_id FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE`,
      [user.orgId, input.userId],
    );
    if (!member.rowCount) throw notFound("可用企业成员不存在");
    await client.query(
      `INSERT INTO project_member(org_id,project_id,user_id,role) VALUES($1,$2,$3,$4)
      ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
      [user.orgId, id, input.userId, input.role],
    );
  });
}

export async function listProjectActivity(user: AuthUser, id: string) {
  await requireProjectAccess(user, id);
  return query<{
    id: string;
    action: string;
    actorName: string | null;
    createdAt: string;
  }>(
    `SELECT a.id,a.action,u.name AS "actorName",a.created_at AS "createdAt"
    FROM audit_log a LEFT JOIN app_user u ON u.id=a.actor_id
    WHERE a.org_id=$1 AND a.resource_type='project' AND a.resource_id=$2 ORDER BY a.created_at DESC,a.id LIMIT 50`,
    [user.orgId, id],
  );
}

// Read models use immutable run provenance, including after a planning task is removed.
export async function projectExecution(
  user: AuthUser,
  id: string,
  kind: "runs" | "artifacts" | "approvals",
  page: number,
  pageSize: number,
) {
  const project = await requireProjectAccess(user, id);
  page = Math.max(1, Math.min(100000, Math.trunc(page) || 1));
  pageSize = Math.max(1, Math.min(100, Math.trunc(pageSize) || 20));
  const { runAccessSql } = await import("./resource-access.js");
  const access = runAccessSql("$3", "false");
  const source =
    kind === "runs"
      ? "agent_run r"
      : kind === "artifacts"
        ? "artifact x JOIN agent_run r ON r.id=x.run_id"
        : "approval x JOIN agent_run r ON r.id=x.run_id";
  const scope = project.is_default
    ? "(r.project_id=$2 OR (r.project_id IS NULL AND r.user_id=$3)) AND r.user_id=$3 AND EXISTS(SELECT 1 FROM project dp JOIN project_member dm ON dm.org_id=dp.org_id AND dm.project_id=dp.id JOIN membership lm ON lm.org_id=dm.org_id AND lm.user_id=dm.user_id WHERE dp.id=$2 AND dp.org_id=$1 AND dp.is_default AND dp.created_by=$3 AND dm.user_id=$3 AND lm.status='active')"
    : "r.project_id=$2";
  const where = `r.org_id=$1 AND ${scope} AND ${access}`;
  const values = [user.orgId, id, user.id];
  const count = await one<{ total: string }>(
    `SELECT count(*)::text AS total FROM ${source} WHERE ${where}`,
    values,
  );
  const projection =
    kind === "runs"
      ? `r.id,(r.project_id IS NULL) AS unassigned,r.status,r.input,r.output,r.created_at AS "createdAt",a.name AS "agentName",pa.task_id AS "taskId",pt.title AS "taskTitle",pa.attempt`
      : kind === "artifacts"
        ? `x.id,x.name,x.mime_type AS "mimeType",x.size,x.run_id AS "runId",x.created_at AS "createdAt",pt.id AS "taskId",pt.title AS "taskTitle"`
        : `x.id,x.status,x.reason,x.tool_name AS "toolName",x.run_id AS "runId",x.created_at AS "createdAt",pt.id AS "taskId",pt.title AS "taskTitle"`;
  const items = await query(
    `SELECT ${projection} FROM ${source}
    JOIN agent a ON a.id=r.agent_id AND a.org_id=r.org_id
    LEFT JOIN project_task_attempt pa ON pa.run_id=r.id AND pa.org_id=r.org_id AND pa.project_id=r.project_id
    LEFT JOIN project_task pt ON pt.id=pa.task_id AND pt.org_id=r.org_id AND pt.project_id=r.project_id
    WHERE ${where} ORDER BY ${kind === "runs" ? "r" : "x"}.created_at DESC,${kind === "runs" ? "r" : "x"}.id DESC LIMIT $4 OFFSET $5`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { items, total: Number(count?.total ?? 0), page, pageSize };
}
