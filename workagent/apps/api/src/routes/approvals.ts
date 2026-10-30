import type { FastifyInstance } from "fastify";
import { decideApprovalSchema } from "@workagent/contracts";
import {
  requireRunAccess,
  runAccessSql,
  canOperate,
  decideApproval,
  mapApproval,
  notFound,
  forbidden,
} from "@workagent/core";
import { one, query } from "@workagent/db";

type ApprovalRow = {
  id: string;
  run_id: string;
  tool_name: string;
  reason: string;
  input: unknown;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_by: string;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  run_user_id: string;
  agent_name: string;
};

function mapRow(row: ApprovalRow) {
  return {
    ...mapApproval(row),
    runUserId: row.run_user_id,
    agentName: row.agent_name,
  };
}

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/approvals", async (request) => {
    const { status } = request.query as { status?: string };
    const conditions = ["r.org_id = $1", runAccessSql("$2", "$3")];
    const params: unknown[] = [
      request.user.orgId,
      request.user.id,
      canOperate(request.user),
    ];
    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }
    const rows = await query<ApprovalRow>(
      `SELECT a.*, r.user_id AS run_user_id, ag.name AS agent_name
         FROM approval a
         JOIN agent_run r ON r.id = a.run_id
         JOIN agent ag ON ag.id = r.agent_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY a.created_at DESC
        LIMIT 200`,
      params,
    );
    return { items: rows.map(mapRow), total: rows.length };
  });

  app.get("/approvals/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = await one<ApprovalRow>(
      `SELECT a.*, r.user_id AS run_user_id, ag.name AS agent_name
         FROM approval a
         JOIN agent_run r ON r.id = a.run_id
         JOIN agent ag ON ag.id = r.agent_id
        WHERE a.id = $1 AND r.org_id = $2`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("审批不存在");
    await requireRunAccess(request.user, row.run_id);
    return { approval: mapRow(row) };
  });

  app.post("/approvals/:id/decide", async (request) => {
    const { id } = request.params as { id: string };
    const input = decideApprovalSchema.parse(request.body);
    const row = await one<{ run_user_id: string; run_id: string }>(
      `SELECT r.id AS run_id,r.user_id AS run_user_id
         FROM approval a JOIN agent_run r ON r.id = a.run_id
        WHERE a.id = $1 AND r.org_id = $2`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("审批不存在");
    await requireRunAccess(request.user, row.run_id, "write");

    const approval = await decideApproval({
      approvalId: id,
      orgId: request.user.orgId,
      userId: request.user.id,
      decision: input.decision,
      note: input.note,
    });
    return { approval };
  });
}
