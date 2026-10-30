import { validateAssertions } from "@workagent/core";
import type { FastifyInstance } from "fastify";
import {
  createEvalCaseSchema,
  createEvalDatasetSchema,
  startEvalRunSchema,
} from "@workagent/contracts";
import {
  compileAgent,
  audit,
  enqueue,
  enqueueWithClient,
  notFound,
  conflict,
} from "@workagent/core";
import { one, query, tx } from "@workagent/db";
import { requireBuild } from "../lib/guards.js";

type DatasetRow = {
  id: string;
  org_id: string;
  agent_id: string;
  name: string;
  description: string;
  created_at: string;
};

type CaseRow = {
  id: string;
  dataset_id: string;
  name: string;
  input: string;
  expected: string | null;
  assertions: Array<{ type: string; value: string }>;
  created_at: string;
};

function mapDataset(row: DatasetRow, caseCount = 0) {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    caseCount,
    createdAt: row.created_at,
  };
}

function mapCase(row: CaseRow) {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    name: row.name,
    input: row.input,
    expected: row.expected,
    assertions: row.assertions,
    createdAt: row.created_at,
  };
}

export async function evalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/eval-datasets", async (request) => {
    const { agentId } = request.query as { agentId?: string };
    const params: unknown[] = [request.user.orgId];
    let condition = "d.org_id = $1";
    if (agentId) {
      params.push(agentId);
      condition += ` AND d.agent_id = $${params.length}`;
    }
    const rows = await query<DatasetRow & { case_count: string }>(
      `SELECT d.*, (SELECT COUNT(*)::text FROM eval_case c WHERE c.dataset_id = d.id) AS case_count
         FROM eval_dataset d
        WHERE ${condition}
        ORDER BY d.created_at DESC`,
      params,
    );
    return {
      items: rows.map((row) => mapDataset(row, Number(row.case_count))),
      total: rows.length,
    };
  });

  app.post("/eval-datasets", async (request) => {
    requireBuild(request.user);
    const input = createEvalDatasetSchema.parse(request.body);
    const agent = await one<{ id: string }>(
      "SELECT id FROM agent WHERE id = $1 AND org_id = $2 AND personal_owner_id IS NULL",
      [input.agentId, request.user.orgId],
    );
    if (!agent) throw notFound("Agent 不存在");
    const row = await one<DatasetRow>(
      `INSERT INTO eval_dataset (org_id, agent_id, name, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [request.user.orgId, input.agentId, input.name, input.description],
    );
    if (!row) throw new Error("failed to create dataset");
    await audit({
      orgId: request.user.orgId,
      actorId: request.user.id,
      action: "eval_dataset.create",
      resourceType: "eval_dataset",
      resourceId: row.id,
      ip: request.ip,
    });
    return { dataset: mapDataset(row) };
  });

  app.get("/eval-datasets/:id", async (request) => {
    const { id } = request.params as { id: string };
    const dataset = await one<DatasetRow>(
      "SELECT * FROM eval_dataset WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!dataset) throw notFound("评测集不存在");
    const cases = await query<CaseRow>(
      "SELECT * FROM eval_case WHERE dataset_id = $1 ORDER BY created_at",
      [id],
    );
    return {
      dataset: mapDataset(dataset, cases.length),
      cases: cases.map(mapCase),
    };
  });

  app.delete("/eval-datasets/:id", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const row = await one<DatasetRow>(
      "DELETE FROM eval_dataset WHERE id = $1 AND org_id = $2 RETURNING *",
      [id, request.user.orgId],
    );
    if (!row) throw notFound("评测集不存在");
    return { ok: true };
  });

  app.post("/eval-datasets/:id/cases", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const dataset = await one<DatasetRow>(
      "SELECT * FROM eval_dataset WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!dataset) throw notFound("评测集不存在");
    const input = createEvalCaseSchema.parse(request.body);
    validateAssertions(input.assertions);
    const row = await one<CaseRow>(
      `INSERT INTO eval_case (dataset_id, name, input, expected, assertions)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [
        id,
        input.name,
        input.input,
        input.expected ?? null,
        JSON.stringify(input.assertions),
      ],
    );
    if (!row) throw new Error("failed to create eval case");
    return { case: mapCase(row) };
  });

  app.delete("/eval-cases/:id", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const row = await one<CaseRow>(
      `DELETE FROM eval_case c USING eval_dataset d
        WHERE c.id = $1 AND d.id = c.dataset_id AND d.org_id = $2
        RETURNING c.*`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("用例不存在");
    return { ok: true };
  });

  app.post("/eval-runs", async (request) => {
    requireBuild(request.user);
    const input = startEvalRunSchema.parse(request.body);
    const dataset = await one<DatasetRow>(
      "SELECT * FROM eval_dataset WHERE id = $1 AND org_id = $2",
      [input.datasetId, request.user.orgId],
    );
    if (!dataset) throw notFound("评测集不存在");

    return tx(async (client) => {
      const one = async <T>(sql: string, params: unknown[]) =>
        (await client.query(sql, params)).rows[0] as T | undefined;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,7))",
        [request.user.orgId],
      );
      const revision = await one<{
        id: string;
        version: number;
        definition: import("@workagent/contracts").AgentDefinition;
      }>(
        "SELECT r.id,r.version,r.definition FROM agent_revision r JOIN agent a ON a.id=r.agent_id WHERE a.id=$1 AND a.org_id=$2 ORDER BY r.version DESC LIMIT 1",
        [dataset.agent_id, request.user.orgId],
      );
      if (!revision) throw notFound("Agent revision missing");
      const compiled = await compileAgent({
        orgId: request.user.orgId,
        agentId: dataset.agent_id,
        revisionId: revision.id,
        version: revision.version,
        definition: revision.definition,
      });
      const row = await one<{
        id: string;
        dataset_id: string;
        agent_revision_id: string;
        status: string;
        total: number;
        passed: number;
        failed: number;
        results: unknown[];
        error: string | null;
        created_at: string;
        finished_at: string | null;
      }>(
        `INSERT INTO eval_run (org_id, dataset_id, agent_revision_id, status,snapshot,revision_checksum)
       VALUES ($1, $2, $3, 'queued',$4::jsonb,$5)
       RETURNING *`,
        [
          request.user.orgId,
          dataset.id,
          revision.id,
          JSON.stringify(compiled.bootstrap),
          compiled.bootstrap.checksum,
        ],
      );
      if (!row) throw new Error("failed to create eval run");

      await enqueueWithClient(client, {
        orgId: request.user.orgId,
        type: "eval.run",
        payload: { evalRunId: row.id },
      });
      return { evalRun: row };
    });
  });

  app.get("/eval-runs", async (request) => {
    const { agentId, datasetId } = request.query as {
      agentId?: string;
      datasetId?: string;
    };
    const params: unknown[] = [request.user.orgId];
    const conditions = ["e.org_id = $1"];
    if (datasetId) {
      params.push(datasetId);
      conditions.push(`e.dataset_id = $${params.length}`);
    }
    if (agentId) {
      params.push(agentId);
      conditions.push(`d.agent_id = $${params.length}`);
    }
    const rows = await query(
      `SELECT e.* FROM eval_run e JOIN eval_dataset d ON d.id = e.dataset_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY e.created_at DESC LIMIT 100`,
      params,
    );
    return { items: rows, total: rows.length };
  });

  app.get("/eval-runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = await one<Record<string, unknown>>(
      "SELECT * FROM eval_run WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!row) throw notFound("评测运行不存在");
    return { evalRun: row };
  });
}
