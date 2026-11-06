import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, query, tx } from "@workagent/db";
import { forbidden, notFound, conflict } from "@workagent/core";
const schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    handler: z.enum(["cleanup", "approval-expiry", "lease-recovery"]),
    intervalMinutes: z.number().int().min(1).max(525600),
    enabled: z.boolean(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export async function platformScheduleRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    if (
      !(await one("SELECT user_id FROM platform_admin WHERE user_id=$1", [
        request.user.id,
      ]))
    )
      throw forbidden();
  });
  app.get("/scheduled-tasks", async () => ({
    items: await query(
      'SELECT id,name,handler,interval_minutes AS "intervalMinutes",enabled,next_at AS "nextAt",version FROM system_schedule ORDER BY created_at DESC',
    ),
  }));
  app.get("/scheduled-tasks/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const task = await one("SELECT * FROM system_schedule WHERE id=$1", [id]);
    if (!task) throw notFound();
    return {
      task,
      runs: await query(
        'SELECT id,status,trigger,result,error,created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt" FROM system_schedule_run WHERE schedule_id=$1 ORDER BY created_at DESC LIMIT 100',
        [id],
      ),
    };
  });
  app.get("/scheduled-runs/:runId", async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
    const run = await one(
      'SELECT id,schedule_id AS "scheduleId",status,trigger,result,error,created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt" FROM system_schedule_run WHERE id=$1',
      [runId],
    );
    if (!run) throw notFound();
    return { item: run };
  });
  app.get("/scheduled-runs/date/:date", async (request) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.params);
    const items = await query(
      'SELECT id,schedule_id AS "scheduleId",status,trigger,result,error,created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt" FROM system_schedule_run WHERE created_at >= $1::date AND created_at < ($1::date + interval \'1 day\') ORDER BY created_at DESC LIMIT 500',
      [date],
    );
    return { items, date };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: method === "POST" ? "/scheduled-tasks" : "/scheduled-tasks/:id",
      handler: async (request, reply) => {
        const input = schema.parse(request.body);
        const id =
          method === "PUT"
            ? z.object({ id: z.string().uuid() }).parse(request.params).id
            : null;
        return tx(async (c) => {
          if (
            !(
              await c.query(
                "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
                [request.user.id],
              )
            ).rowCount
          )
            throw forbidden();
          if (id) {
            const row = (
              await c.query<{ version: number }>(
                "SELECT version FROM system_schedule WHERE id=$1 FOR UPDATE",
                [id],
              )
            ).rows[0];
            if (!row) throw notFound();
            if (row.version !== input.expectedVersion)
              throw conflict("任务已更新，请刷新");
          }
          const result = id
            ? await c.query(
                "UPDATE system_schedule SET name=$2,handler=$3,interval_minutes=$4,enabled=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING id",
                [
                  id,
                  input.name,
                  input.handler,
                  input.intervalMinutes,
                  input.enabled,
                ],
              )
            : await c.query(
                "INSERT INTO system_schedule(name,handler,interval_minutes,enabled) VALUES($1,$2,$3,$4) RETURNING id",
                [
                  input.name,
                  input.handler,
                  input.intervalMinutes,
                  input.enabled,
                ],
              );
          await c.query(
            "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'schedule.save',$2)",
            [
              request.user.id,
              JSON.stringify({ id: result.rows[0].id, ...input }),
            ],
          );
          if (!id) reply.code(201);
          return { id: result.rows[0].id };
        });
      },
    });
  app.post("/scheduled-tasks/:id/trigger", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return tx(async (c) => {
      if (
        !(
          await c.query(
            "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
            [request.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      if (
        !(
          await c.query(
            "SELECT id FROM system_schedule WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rowCount
      )
        throw notFound();
      if (
        (
          await c.query(
            "SELECT id FROM system_schedule_run WHERE schedule_id=$1 AND status IN ('queued','running')",
            [id],
          )
        ).rowCount
      )
        throw conflict("任务已有活跃执行");
      const run = (
        await c.query(
          "INSERT INTO system_schedule_run(schedule_id,trigger) VALUES($1,'manual') RETURNING id",
          [id],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'schedule.trigger',$2)",
        [request.user.id, JSON.stringify({ scheduleId: id, runId: run.id })],
      );
      return { runId: run.id };
    });
  });
  app.post("/scheduled-tasks/:id/runs/:runId/retry", async (request) => {
    const { id, runId } = z
      .object({ id: z.string().uuid(), runId: z.string().uuid() })
      .parse(request.params);
    return tx(async (c) => {
      if (
        !(
          await c.query(
            "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
            [request.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      if (
        !(
          await c.query(
            "SELECT id FROM system_schedule_run WHERE id=$1 AND schedule_id=$2 AND status='failed' FOR UPDATE",
            [runId, id],
          )
        ).rowCount
      )
        throw conflict("仅失败执行可重试");
      if (
        (
          await c.query(
            "SELECT id FROM system_schedule_run WHERE schedule_id=$1 AND status IN ('queued','running')",
            [id],
          )
        ).rowCount
      )
        throw conflict("任务已有活跃执行");
      const run = (
        await c.query(
          "INSERT INTO system_schedule_run(schedule_id,trigger) VALUES($1,'manual') RETURNING id",
          [id],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'schedule.retry',$2)",
        [
          request.user.id,
          JSON.stringify({ scheduleId: id, failedRunId: runId, runId: run.id }),
        ],
      );
      return { runId: run.id };
    });
  });
  app.post("/scheduled-tasks/:id/runs/:runId/cancel", async (request) => {
    const { id, runId } = z
      .object({ id: z.string().uuid(), runId: z.string().uuid() })
      .parse(request.params);
    return tx(async (c) => {
      if (
        !(
          await c.query(
            "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
            [request.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      const r = await c.query(
        "UPDATE system_schedule_run SET status='skipped',error='由平台管理员取消',finished_at=now() WHERE id=$1 AND schedule_id=$2 AND status='queued'",
        [runId, id],
      );
      if (!r.rowCount) throw conflict("仅等待执行的任务可取消");
      await c.query(
        "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'schedule.cancel',$2)",
        [request.user.id, JSON.stringify({ scheduleId: id, runId })],
      );
      return { ok: true };
    });
  });
}
