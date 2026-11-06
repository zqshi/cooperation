import { query, tx, pool } from "@workagent/db";
import { cleanupExpired } from "./cleanup.js";
import { expirePendingApprovals } from "./runs.js";
import { recoverStaleJobs } from "./queue.js";
/** Only allowlisted local maintenance handlers; no arbitrary commands or outbound destinations. */
export async function tickSystemSchedules() {
  await tx(async (c) => {
    const due = await c.query<{ id: string; interval_minutes: number }>(
      "SELECT id,interval_minutes FROM system_schedule WHERE enabled AND next_at<=now() ORDER BY next_at LIMIT 20 FOR UPDATE SKIP LOCKED",
    );
    for (const schedule of due.rows) {
      await c.query(
        "INSERT INTO system_schedule_run(schedule_id,trigger) SELECT $1,'scheduled' WHERE NOT EXISTS(SELECT 1 FROM system_schedule_run WHERE schedule_id=$1 AND status IN ('queued','running')) ON CONFLICT DO NOTHING",
        [schedule.id],
      );
      await c.query(
        "UPDATE system_schedule SET next_at=now()+interval '1 minute' * interval_minutes WHERE id=$1",
        [schedule.id],
      );
    }
  });
  const candidates = await query<{ id: string; handler: string }>(
    "SELECT r.id,s.handler FROM system_schedule_run r JOIN system_schedule s ON s.id=r.schedule_id WHERE r.status='queued' ORDER BY r.created_at LIMIT 20",
  );
  for (const row of candidates) {
    const client = await pool.connect();
    let acquired = false;
    try {
      acquired = Boolean(
        (
          await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1,721)) AS locked",
            [row.id],
          )
        ).rows[0]?.locked,
      );
      if (!acquired) continue;
      const claimed = await client.query(
        "UPDATE system_schedule_run SET status='running',started_at=now() WHERE id=$1 AND status='queued' RETURNING id",
        [row.id],
      );
      if (!claimed.rowCount) continue;
      try {
        let result: unknown;
        if (row.handler === "cleanup") result = await cleanupExpired();
        else if (row.handler === "approval-expiry")
          result = await expirePendingApprovals();
        else if (row.handler === "lease-recovery")
          result = await recoverStaleJobs();
        else throw new Error("Unknown handler");
        await client.query(
          "UPDATE system_schedule_run SET status='succeeded',result=$2,finished_at=now() WHERE id=$1",
          [row.id, JSON.stringify(result ?? { ok: true })],
        );
      } catch {
        await client.query(
          "UPDATE system_schedule_run SET status='failed',error='维护执行失败，请检查服务日志',finished_at=now() WHERE id=$1",
          [row.id],
        );
      }
    } finally {
      if (acquired)
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,721))",
          [row.id],
        );
      client.release();
    }
  }
  // A process holds the row-level advisory lock for every live run; only reclaim when it is free.
  const stale = await query<{ id: string }>(
    "SELECT id FROM system_schedule_run WHERE status='running' AND started_at<now()-interval '2 minutes' ORDER BY started_at LIMIT 20",
  );
  for (const run of stale) {
    const c = await pool.connect();
    let acquired = false;
    try {
      acquired = Boolean(
        (
          await c.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1,721)) AS locked",
            [run.id],
          )
        ).rows[0]?.locked,
      );
      if (acquired)
        await c.query(
          "UPDATE system_schedule_run SET status='failed',error='执行进程中断，租约恢复后标记失败',finished_at=now() WHERE id=$1 AND status='running'",
          [run.id],
        );
    } finally {
      if (acquired)
        await c.query("SELECT pg_advisory_unlock(hashtextextended($1,721))", [
          run.id,
        ]);
      c.release();
    }
  }
}
