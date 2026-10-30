import { tx, query, one } from "@workagent/db";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type {
  ProjectTask,
  taskInputSchema,
  taskUpdateSchema,
} from "@workagent/contracts";
import type { AuthUser } from "./auth.js";
import { forbidden, notFound, conflict } from "./errors.js";
import { requireProjectAccess } from "./projects.js";
import { createRun } from "./runs.js";

async function lockProject(
  c: PoolClient,
  u: AuthUser,
  id: string,
  manage = false,
) {
  // Serialize project mutations before reading roles; removal cannot race a write.
  await c.query("SELECT id FROM project WHERE org_id=$1 AND id=$2 FOR UPDATE", [
    u.orgId,
    id,
  ]);
  const privateProject = await c.query(
    "SELECT id FROM project WHERE org_id=$1 AND id=$2 AND is_default AND created_by<>$3",
    [u.orgId, id, u.id],
  );
  if (privateProject.rowCount) throw notFound();
  const r = await c.query<{ role: string }>(
    `SELECT pm.role FROM project_member pm JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id WHERE pm.org_id=$1 AND pm.project_id=$2 AND pm.user_id=$3 AND m.status='active' FOR SHARE OF pm,m`,
    [u.orgId, id, u.id],
  );
  if (!r.rows[0]) throw notFound();
  if (r.rows[0].role === "viewer" || (manage && r.rows[0].role !== "manager"))
    throw forbidden();
  return r.rows[0].role;
}
async function log(c: PoolClient, u: AuthUser, id: string, action: string) {
  await c.query(
    "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id) VALUES($1,$2,$3,'project',$4)",
    [u.orgId, u.id, action, id],
  );
}
async function validateAssignments(
  c: PoolClient,
  u: AuthUser,
  id: string,
  assignee: string | null,
  agent: string | null,
) {
  if (assignee) {
    const r = await c.query(
      `SELECT pm.user_id FROM project_member pm JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id WHERE pm.org_id=$1 AND pm.project_id=$2 AND pm.user_id=$3 AND pm.role!='viewer' AND m.status='active' FOR SHARE OF pm,m`,
      [u.orgId, id, assignee],
    );
    if (!r.rowCount) throw notFound("执行者必须是有效项目参与者");
  }
  if (
    agent &&
    !(
      await c.query(
        "SELECT id FROM agent WHERE org_id=$1 AND id=$2 AND status='published' AND personal_owner_id IS NULL AND (visibility!='private' OR created_by=$3 OR EXISTS(SELECT 1 FROM membership WHERE org_id=$1 AND user_id=$3 AND status='active' AND role IN ('owner','admin','builder'))) FOR SHARE",
        [u.orgId, agent, assignee ?? u.id],
      )
    ).rowCount
  )
    throw notFound("Agent 不可用");
}
export async function listProjectTasks(u: AuthUser, id: string) {
  await requireProjectAccess(u, id);
  return query<ProjectTask>(
    "SELECT * FROM project_task WHERE org_id=$1 AND project_id=$2 ORDER BY created_at",
    [u.orgId, id],
  );
}
export async function createProjectTask(
  u: AuthUser,
  id: string,
  input: z.infer<typeof taskInputSchema>,
) {
  return tx(async (c) => {
    const role = await lockProject(c, u, id);
    if (role !== "manager" && input.assigneeId && input.assigneeId !== u.id)
      throw forbidden();
    await validateAssignments(c, u, id, input.assigneeId, input.agentId);
    const r = await c.query<ProjectTask>(
      "INSERT INTO project_task(org_id,project_id,title,description,assignee_id,agent_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        u.orgId,
        id,
        input.title,
        input.description,
        input.assigneeId,
        input.agentId,
        u.id,
      ],
    );
    await log(c, u, id, "project.task.create");
    return r.rows[0]!;
  });
}
export async function updateProjectTask(
  u: AuthUser,
  id: string,
  taskId: string,
  input: z.infer<typeof taskUpdateSchema>,
) {
  return tx(async (c) => {
    const role = await lockProject(c, u, id);
    const r = await c.query<ProjectTask>(
      "SELECT * FROM project_task WHERE org_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
      [u.orgId, id, taskId],
    );
    const t = r.rows[0];
    if (!t) throw notFound();
    if (
      input.status === t.status &&
      ["review", "done"].includes(t.status) &&
      input.version === t.version - 1 &&
      (t.status === "done"
        ? t.accepted_by === u.id
        : t.submitted_by === u.id) &&
      Object.keys(input).every((k) => ["status", "version"].includes(k))
    )
      return t;
    if (t.version !== input.version) throw conflict("任务已更新，请刷新");
    if (t.status === "done") throw conflict("已验收任务不可修改");
    const status = input.status ?? t.status;
    if (role !== "manager" && t.assignee_id !== u.id)
      throw forbidden("仅执行者可修改任务");
    if (
      role !== "manager" &&
      (input.assigneeId !== undefined || input.agentId !== undefined)
    )
      throw forbidden("仅项目经理可调整指派");
    if (input.status && input.status !== t.status) {
      const allowed: Record<string, string[]> = {
        todo: ["doing", "review"],
        doing: ["todo", "review"],
        review: ["doing", "done"],
        done: [],
      };
      if (!allowed[t.status]?.includes(status))
        throw conflict("不支持的任务状态转换");
      if (t.status === "review" && role !== "manager")
        throw forbidden("仅项目经理可退回或验收");
    }
    if (
      status === "review" &&
      t.status !== "review" &&
      (!t.assignee_id ||
        u.id !== t.assignee_id ||
        input.assigneeId !== undefined ||
        input.agentId !== undefined)
    )
      throw forbidden("必须由原指派执行者提交");
    if (
      t.status === "review" &&
      (input.assigneeId !== undefined ||
        input.agentId !== undefined ||
        input.title !== undefined ||
        input.description !== undefined)
    )
      throw conflict("审核中的任务请先退回");
    const assignee =
      input.assigneeId === undefined ? t.assignee_id : input.assigneeId;
    const agent = input.agentId === undefined ? t.agent_id : input.agentId;
    await validateAssignments(c, u, id, assignee, agent);
    if (status === "done") {
      await lockProject(c, u, id, true);
      if (
        t.status !== "review" ||
        u.id === t.submitted_by ||
        u.id === t.assignee_id
      )
        throw forbidden("执行者不能自验收，任务必须先提交审核");
    }
    if (input.status === "review" && t.assignee_id && u.id !== t.assignee_id)
      throw forbidden("仅执行者可提交验收");
    if (input.status === "review" && t.agent_id) {
      const latest = (
        await c.query<{ status: string }>(
          "SELECT r.status FROM project_task_attempt a JOIN agent_run r ON r.id=a.run_id WHERE a.task_id=$1 ORDER BY a.attempt DESC LIMIT 1",
          [taskId],
        )
      ).rows[0];
      if (latest?.status !== "succeeded")
        throw conflict("Agent 执行成功后才能提交验收");
    }
    const result = await c.query<ProjectTask>(
      `UPDATE project_task SET title=$4,description=$5,assignee_id=$6,agent_id=$7,status=$8,submitted_by=CASE WHEN $8='review' AND status!='review' THEN $9 ELSE submitted_by END,accepted_by=CASE WHEN $8='done' THEN $9 ELSE NULL END,version=version+1,updated_at=now() WHERE org_id=$1 AND project_id=$2 AND id=$3 RETURNING *`,
      [
        u.orgId,
        id,
        taskId,
        input.title ?? t.title,
        input.description ?? t.description,
        assignee,
        agent,
        status,
        u.id,
      ],
    );
    await log(c, u, id, "project.task." + status);
    return result.rows[0]!;
  });
}
export async function deleteProjectTask(
  u: AuthUser,
  id: string,
  taskId: string,
) {
  await tx(async (c) => {
    await lockProject(c, u, id, true);
    const r = await c.query(
      "DELETE FROM project_task WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status!='done' RETURNING id",
      [u.orgId, id, taskId],
    );
    if (!r.rowCount) throw conflict("任务不存在或已验收");
    await log(c, u, id, "project.task.delete");
  });
}
export async function removeProjectMember(
  u: AuthUser,
  id: string,
  target: string,
  transfer = false,
) {
  await tx(async (c) => {
    await lockProject(c, u, id, true);
    if (
      (
        await c.query(
          "SELECT id FROM project WHERE org_id=$1 AND id=$2 AND is_default",
          [u.orgId, id],
        )
      ).rowCount
    )
      throw forbidden("默认项目成员和所有权不可变更");
    const owner = await c.query(
      "SELECT id FROM project WHERE org_id=$1 AND id=$2 AND created_by=$3",
      [u.orgId, id, u.id],
    );
    if (transfer && !owner.rowCount) throw forbidden("只有所有者可转移所有权");
    if (target === u.id) throw forbidden("不能移除自己");
    if (transfer) {
      if (
        !(
          await c.query(
            `SELECT pm.user_id FROM project_member pm JOIN membership m ON m.org_id=pm.org_id AND m.user_id=pm.user_id WHERE pm.org_id=$1 AND pm.project_id=$2 AND pm.user_id=$3 AND m.status='active'`,
            [u.orgId, id, target],
          )
        ).rowCount
      )
        throw notFound();
      await c.query(
        "UPDATE project SET created_by=$3 WHERE org_id=$1 AND id=$2",
        [u.orgId, id, target],
      );
      await c.query(
        "UPDATE project_member SET role=CASE WHEN user_id=$3 THEN 'manager' ELSE 'contributor' END WHERE org_id=$1 AND project_id=$2 AND user_id=ANY($4::text[])",
        [u.orgId, id, target, [target, u.id]],
      );
    } else {
      const p = await c.query(
        "SELECT id FROM project WHERE org_id=$1 AND id=$2 AND created_by=$3",
        [u.orgId, id, target],
      );
      if (p.rowCount) throw conflict("请先转移所有权");
      await c.query(
        "UPDATE project_task SET assignee_id=NULL,version=version+1 WHERE org_id=$1 AND project_id=$2 AND assignee_id=$3 AND status!='done'",
        [u.orgId, id, target],
      );
      await c.query(
        "DELETE FROM project_member WHERE org_id=$1 AND project_id=$2 AND user_id=$3",
        [u.orgId, id, target],
      );
    }
    await log(
      c,
      u,
      id,
      transfer ? "project.transfer" : "project.member.remove",
    );
  });
}
export async function startTaskAttempt(
  u: AuthUser,
  id: string,
  taskId: string,
  key: string,
) {
  // createRun is idempotent; holding the task lock prevents competing attempt numbers.
  return tx(async (c) => {
    await lockProject(c, u, id);
    const t = (
      await c.query<ProjectTask>(
        "SELECT * FROM project_task WHERE org_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [u.orgId, id, taskId],
      )
    ).rows[0];
    if (!t || !t.agent_id) throw notFound("任务没有 Agent");
    if (t.assignee_id !== u.id || t.status === "done" || t.status === "review")
      throw forbidden();
    const prior = (
      await c.query<{ response: { runId: string } }>(
        "SELECT response FROM idempotency_record WHERE org_id=$1 AND scope='run.create' AND key=$2",
        [u.orgId, `${u.id}:task:${taskId}:${key}`],
      )
    ).rows[0];
    const active = (
      await c.query(
        "SELECT a.run_id FROM project_task_attempt a JOIN agent_run r ON r.id=a.run_id WHERE a.task_id=$1 AND r.status IN ('queued','running','waiting_approval')",
        [taskId],
      )
    ).rowCount;
    if (active && !prior) throw conflict("任务已有执行中的尝试");
    const result = await createRun(
      {
        orgId: u.orgId,
        userId: u.id,
        agentId: t.agent_id,
        projectId: id,
        message: `${t.title}\n${t.description}`,
        idempotencyKey: `task:${taskId}:${key}`,
      },
      c,
    );
    if (prior) return result;
    await c.query(
      "INSERT INTO project_task_attempt(org_id,project_id,task_id,attempt,run_id,created_by) SELECT $1,$2,$3,COALESCE(MAX(attempt),0)+1,$4,$5 FROM project_task_attempt WHERE task_id=$3 ON CONFLICT(run_id) DO NOTHING",
      [u.orgId, id, taskId, result.run.id, u.id],
    );
    await c.query(
      "UPDATE project_task SET status='doing',version=version+1 WHERE id=$1",
      [taskId],
    );
    await log(c, u, id, "project.task.attempt");
    return result;
  });
}
export async function taskReferences(
  u: AuthUser,
  id: string,
  taskId: string,
  artifactId?: string,
) {
  await requireProjectAccess(u, id);
  if (
    !(await one(
      "SELECT id FROM project_task WHERE org_id=$1 AND project_id=$2 AND id=$3",
      [u.orgId, id, taskId],
    ))
  )
    throw notFound("任务不存在或不属于此项目");
  if (artifactId)
    await tx(async (c) => {
      await lockProject(c, u, id);
      const r = await c.query(
        `SELECT ar.id FROM artifact ar JOIN project_task_attempt a ON a.run_id=ar.run_id WHERE a.org_id=$1 AND a.project_id=$2 AND a.task_id=$3 AND ar.id=$4`,
        [u.orgId, id, taskId, artifactId],
      );
      if (!r.rowCount) throw notFound("产物必须来自该任务的执行尝试");
      await c.query(
        "INSERT INTO project_task_reference(org_id,project_id,task_id,artifact_id,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [u.orgId, id, taskId, artifactId, u.id],
      );
      await log(c, u, id, "project.task.reference");
    });
  return {
    attempts: await query(
      "SELECT a.*,r.status,r.output FROM project_task_attempt a JOIN agent_run r ON r.id=a.run_id WHERE a.org_id=$1 AND a.project_id=$2 AND a.task_id=$3 ORDER BY attempt",
      [u.orgId, id, taskId],
    ),
    artifacts: await query(
      "SELECT ar.id,ar.name,ar.run_id,EXISTS(SELECT 1 FROM project_task_reference ref WHERE ref.task_id=a.task_id AND ref.artifact_id=ar.id AND ref.org_id=a.org_id AND ref.project_id=a.project_id) AS referenced FROM artifact ar JOIN project_task_attempt a ON a.run_id=ar.run_id WHERE a.org_id=$1 AND a.project_id=$2 AND a.task_id=$3",
      [u.orgId, id, taskId],
    ),
  };
}
