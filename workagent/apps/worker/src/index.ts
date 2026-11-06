import { config } from "@workagent/config";
import fs from "node:fs/promises";
import type { OutboundChannelMessage } from "@workagent/contracts";
import {
  cleanupExpired,
  dispatchDueAutomations,
  tickSystemSchedules,
  createWorker,
  executeEvalRun,
  executeRun,
  expirePendingApprovals,
  ingestDocument,
  recoverStaleJobs,
  sendChannelMessage,
} from "@workagent/core";
import { closePool, one } from "@workagent/db";

async function main(): Promise<void> {
  await recoverStaleJobs();
  await cleanupExpired();

  const worker = createWorker({
    name: "workagent-worker",
    concurrency: config.workerConcurrency,
    handlers: {
      "run.execute": async (job) => {
        const runId = String(job.payload.runId ?? "");
        const run = await one<{ org_id: string }>(
          "SELECT org_id FROM agent_run WHERE id = $1",
          [runId],
        );
        if (run?.org_id !== job.org_id)
          throw new Error("Job enterprise mismatch");
        if (!run) throw new Error(`run not found: ${runId}`);
        await executeRun(runId, run.org_id);
      },
      "document.ingest": async (job) => {
        const documentId = String(job.payload.documentId ?? "");
        const doc = await one<{ org_id: string }>(
          "SELECT org_id FROM document WHERE id=$1",
          [documentId],
        );
        if (doc?.org_id !== job.org_id)
          throw new Error("Job enterprise mismatch");
        await ingestDocument(documentId);
      },
      "eval.run": async (job) => {
        const evalRunId = String(job.payload.evalRunId ?? "");
        const evalRun = await one<{ org_id: string }>(
          "SELECT org_id FROM eval_run WHERE id = $1",
          [evalRunId],
        );
        if (evalRun?.org_id !== job.org_id)
          throw new Error("Job enterprise mismatch");
        if (!evalRun) throw new Error(`eval run not found: ${evalRunId}`);
        await executeEvalRun(evalRunId, evalRun.org_id);
      },
      "channel.send": async (job) => {
        await sendChannelMessage(
          job.payload as unknown as OutboundChannelMessage,
        );
      },
    },
    onError: (error, job) => {
      console.error(
        `[worker] job failed`,
        job?.type,
        job?.id,
        error instanceof Error ? error.name : "unknown",
      );
    },
  });

  let scheduling = false;
  const tickSchedules = async () => {
    if (scheduling) return;
    scheduling = true;
    try {
      await dispatchDueAutomations();
      await tickSystemSchedules();
    } catch {
      console.error("[worker] automation dispatch failed");
    } finally {
      scheduling = false;
    }
  };
  await tickSchedules();
  const scheduleTimer = setInterval(() => void tickSchedules(), 5000);
  const expiryTimer = setInterval(
    () => {
      void cleanupExpired().catch(() =>
        console.error("[worker] cleanup failed"),
      );
      void expirePendingApprovals().catch((error) =>
        console.error("[worker] expire approvals failed"),
      );
    },
    60 * 60 * 1000,
  );

  const health = async () => {
    await one("SELECT 1");
    await fs.writeFile("/tmp/workagent-worker-health", String(Date.now()));
  };
  await health();
  const healthTimer = setInterval(() => {
    void health().catch(() => undefined);
  }, 15_000);
  console.log("WorkAgent worker started");

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down`);
    clearInterval(scheduleTimer);
    clearInterval(expiryTimer);
    clearInterval(healthTimer);
    await worker.stop();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
