import type { FastifyInstance } from "fastify";
import { query, tx } from "@workagent/db";
import {
  requireRunAccess,
  requireRole,
  notFound,
  conflict,
} from "@workagent/core";
export async function queueRoutes(app: FastifyInstance) {
  app.get("/queue", async (req) => {
    requireRole(req.user, ["owner", "admin", "auditor"]);
    return {
      items: await query(
        "SELECT id,type,status,attempts,last_error,run_at,locked_at FROM outbox_event WHERE org_id=$1 ORDER BY run_at DESC LIMIT 200",
        [req.user.orgId],
      ),
    };
  });
  app.post<{ Params: { id: string } }>("/queue/:id/retry", async (req) => {
    requireRole(req.user, ["owner", "admin"]);
    return tx(async (c) => {
      const row = (
        await c.query<{ payload: { runId?: string }; status: string }>(
          "SELECT payload,status FROM outbox_event WHERE org_id=$1 AND id=$2 FOR UPDATE",
          [req.user.orgId, req.params.id],
        )
      ).rows[0];
      if (!row) throw notFound();
      if (row.status !== "failed")
        throw conflict("Only dead-letter jobs can be retried");
      if (
        row.payload.runId &&
        (
          await c.query(
            "SELECT run_id FROM tool_invocation WHERE run_id=$1 AND org_id=$2 AND status!='succeeded'",
            [row.payload.runId, req.user.orgId],
          )
        ).rowCount
      )
        throw conflict("Reconcile uncertain tool side effects before retrying");
      if (row.payload.runId) {
        await requireRunAccess(req.user, row.payload.runId, true);
        const run = (
          await c.query<{ status: string }>(
            "SELECT status FROM agent_run WHERE id=$1 AND org_id=$2 FOR UPDATE",
            [row.payload.runId, req.user.orgId],
          )
        ).rows[0];
        if (!run || ["succeeded", "canceled", "timeout"].includes(run.status))
          throw conflict("Terminal run requires a new task attempt");
        if (run.status === "failed")
          await c.query(
            "UPDATE agent_run SET status='queued',error=NULL,finished_at=NULL,started_at=now() WHERE id=$1",
            [row.payload.runId],
          );
      }
      await c.query(
        "UPDATE outbox_event SET status='pending',attempts=0,run_at=now(),last_error=NULL,locked_at=NULL,locked_by=NULL WHERE org_id=$1 AND id=$2",
        [req.user.orgId, req.params.id],
      );
      await c.query(
        "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id) VALUES($1,$2,'queue.retry','outbox',$3)",
        [req.user.orgId, req.user.id, req.params.id],
      );
      return { ok: true };
    });
  });
}
