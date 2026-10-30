import crypto from "node:crypto";
import { one, query } from "@workagent/db";

export type Job = {
  id: string;
  org_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  locked_by: string;
};

export type JobHandler = (job: Job) => Promise<void>;

export type EnqueueInput = {
  orgId: string;
  type: string;
  payload: Record<string, unknown>;
  delayMs?: number;
};

export async function enqueue(input: EnqueueInput): Promise<string> {
  return enqueueWithClient({ query }, input);
}

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

export async function enqueueWithClient(
  client: Queryable,
  input: EnqueueInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const runAt = new Date(Date.now() + (input.delayMs ?? 0)).toISOString();
  await client.query(
    `INSERT INTO outbox_event (id, org_id, type, payload, run_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [id, input.orgId, input.type, JSON.stringify(input.payload), runAt],
  );
  return id;
}

export async function recoverStaleJobs(): Promise<void> {
  await query(
    `UPDATE outbox_event
        SET status = CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END, locked_at = NULL, locked_by = NULL
      WHERE status = 'processing' AND locked_at < now() - interval '2 minutes'`,
  );
}

async function claimJob(workerId: string): Promise<Job | null> {
  const row = await one<Job>(
    `UPDATE outbox_event
        SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM outbox_event
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY run_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, org_id, type, payload, attempts, locked_by`,
    [workerId],
  );
  return row;
}

async function completeJob(job: Job): Promise<void> {
  await query(
    `UPDATE outbox_event
        SET status = 'processed', processed_at = now(), locked_at = NULL, locked_by = NULL
      WHERE id = $1 AND status='processing' AND locked_by=$2 AND attempts=$3`,
    [job.id, job.locked_by, job.attempts],
  );
}

async function failJob(
  job: Job,
  error: unknown,
  maxAttempts: number,
): Promise<void> {
  const message =
    "Job execution failed; inspect redacted operational telemetry";
  if (job.attempts >= maxAttempts) {
    await query(
      `UPDATE outbox_event
          SET status = 'failed', last_error = $2, locked_at = NULL, locked_by = NULL
        WHERE id = $1 AND status='processing' AND locked_by=$3 AND attempts=$4`,
      [job.id, message, job.locked_by, job.attempts],
    );
    return;
  }
  const backoffMs = Math.min(60_000, 1000 * 2 ** job.attempts);
  await query(
    `UPDATE outbox_event
        SET status = 'pending', last_error = $2, locked_at = NULL, locked_by = NULL,
            run_at = now() + ($3 || ' milliseconds')::interval
      WHERE id = $1 AND status='processing' AND locked_by=$4 AND attempts=$5`,
    [job.id, message, String(backoffMs), job.locked_by, job.attempts],
  );
}

export type WorkerOptions = {
  name: string;
  handlers: Record<string, JobHandler>;
  concurrency?: number;
  pollMs?: number;
  maxAttempts?: number;
  heartbeatMs?: number;
  onError?: (error: unknown, job?: Job) => void;
};

export function createWorker(options: WorkerOptions): {
  stop: () => Promise<void>;
} {
  const concurrency = options.concurrency ?? 2;
  const pollMs = options.pollMs ?? 500;
  const maxAttempts = options.maxAttempts ?? 3;
  let stopped = false;

  async function loop(index: number): Promise<void> {
    const workerId = `${options.name}-${process.pid}-${index}-${crypto.randomUUID().slice(0, 8)}`;
    while (!stopped) {
      let job: Job | null = null;
      try {
        job = await claimJob(workerId);
      } catch (error) {
        options.onError?.(error);
        await sleep(pollMs);
        continue;
      }
      if (!job) {
        await sleep(pollMs);
        continue;
      }

      const handler = options.handlers[job.type];
      if (!handler) {
        await failJob(
          job,
          new Error(`no handler for ${job.type}`),
          maxAttempts,
        );
        continue;
      }

      const activeJob = job;
      const heartbeat = setInterval(() => {
        void query(
          "UPDATE outbox_event SET locked_at=now() WHERE id=$1 AND locked_by=$2 AND attempts=$3 AND status='processing'",
          [activeJob.id, activeJob.locked_by, activeJob.attempts],
        ).catch(() => undefined);
      }, options.heartbeatMs ?? 20_000);
      try {
        await handler(job);
        await completeJob(job);
      } catch (error) {
        options.onError?.(error, job);
        await failJob(job, error, maxAttempts);
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  const recovery = setInterval(() => {
    void recoverStaleJobs().catch(() => undefined);
  }, 30_000);
  const loops = Array.from({ length: concurrency }, (_, index) => loop(index));

  return {
    stop: async () => {
      stopped = true;
      clearInterval(recovery);
      await Promise.allSettled(loops);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
