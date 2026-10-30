import { badRequest } from "./errors.js";
import { compileSchema, assertRegex } from "./json-schema.js";
import type { EvalResult } from "@workagent/contracts";
import { one, query, pool } from "@workagent/db";
import { previewAgent } from "./preview.js";
import type { RuntimeBootstrapSnapshot } from "@workagent/contracts";

type Assertion = { type: string; value: string };

export async function executeEvalRun(
  evalRunId: string,
  orgId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    const locked = (
      await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,8)) AS locked",
        [evalRunId],
      )
    ).rows[0]?.locked;
    if (!locked) {
      throw new Error("Eval already leased");
    }
    try {
      await executeEvalRunLocked(evalRunId, orgId);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,8))", [
        evalRunId,
      ]);
    }
  } finally {
    client.release();
  }
}
async function executeEvalRunLocked(
  evalRunId: string,
  orgId: string,
): Promise<void> {
  const evalRun = await one<{
    id: string;
    dataset_id: string;
    agent_revision_id: string;
    status: string;
    snapshot: RuntimeBootstrapSnapshot | null;
  }>(
    "SELECT id, dataset_id, agent_revision_id, status,snapshot FROM eval_run WHERE id = $1 AND org_id = $2",
    [evalRunId, orgId],
  );
  if (!evalRun) throw new Error(`eval run not found: ${evalRunId}`);
  if (evalRun.status === "succeeded") return;

  const revision = await one<{ bootstrap: RuntimeBootstrapSnapshot | null }>(
    "SELECT r.bootstrap FROM agent_revision r JOIN agent a ON a.id=r.agent_id WHERE r.id=$1 AND a.org_id=$2",
    [evalRun.agent_revision_id, orgId],
  );
  if (!evalRun.snapshot && !revision?.bootstrap)
    throw new Error("eval revision bootstrap missing");
  const bootstrap = evalRun.snapshot ?? revision!.bootstrap!;

  const cases = await query<{
    id: string;
    name: string;
    input: string;
    expected: string | null;
    assertions: Assertion[];
  }>(
    "SELECT id, name, input, expected, assertions FROM eval_case WHERE dataset_id = $1 ORDER BY created_at LIMIT 500",
    [evalRun.dataset_id],
  );

  await query(
    "UPDATE eval_run SET status = 'running', total = $2 WHERE id = $1",
    [evalRunId, cases.length],
  );

  const dataset = await one<{ agent_id: string }>(
    "SELECT agent_id FROM eval_dataset WHERE id = $1 AND org_id=$2",
    [evalRun.dataset_id, orgId],
  );
  if (!dataset) throw new Error("eval dataset missing");

  const results: EvalResult[] = [];
  for (const evalCase of cases) {
    const start = Date.now();
    let output = "";
    let toolNames: string[] = [];
    let costUsd = 0;
    let executionFailed = false;
    try {
      const preview = await previewAgent({
        bootstrap,
        message: evalCase.input,
        orgId,
        userId: "system",
        agentId: dataset.agent_id,
      });
      output = preview.output;
      toolNames = preview.toolCalls;
      costUsd = preview.costUsd;
    } catch (error) {
      output = "执行失败";
      executionFailed = true;
    }

    const failures = checkAssertions(
      output,
      toolNames,
      evalCase.assertions ?? [],
    );
    if (executionFailed) failures.push("Execution failed");
    if (evalCase.expected && !output.includes(evalCase.expected)) {
      failures.push(`输出未包含期望内容: ${evalCase.expected}`);
    }
    results.push({
      caseId: evalCase.id,
      passed: failures.length === 0,
      output,
      failures,
      latencyMs: Date.now() - start,
      costUsd,
    });
  }

  const passed = results.filter((item) => item.passed).length;
  const failed = results.length - passed;
  await query(
    `UPDATE eval_run
        SET status = 'succeeded', total = $2, passed = $3, failed = $4, results = $5::jsonb, finished_at = now()
      WHERE id = $1`,
    [evalRunId, results.length, passed, failed, JSON.stringify(results)],
  );
}

export function checkAssertions(
  output: string,
  toolNames: string[],
  assertions: Assertion[],
): string[] {
  const failures: string[] = [];
  for (const assertion of assertions) {
    switch (assertion.type) {
      case "contains":
        if (!output.includes(assertion.value))
          failures.push(`输出不包含: ${assertion.value}`);
        break;
      case "not_contains":
        if (output.includes(assertion.value))
          failures.push(`输出不应包含: ${assertion.value}`);
        break;
      case "regex":
        try {
          if (!assertRegex(assertion.value).matcher(output).find())
            failures.push(`不匹配正则: ${assertion.value}`);
        } catch {
          failures.push(`无效正则: ${assertion.value}`);
        }
        break;
      case "tool_called":
        if (!toolNames.includes(assertion.value))
          failures.push(`未调用工具: ${assertion.value}`);
        break;
      case "json_schema":
        failures.push(...checkJsonSchema(output, assertion.value));
        break;
      default:
        failures.push(`未知断言类型: ${assertion.type}`);
    }
  }
  return failures;
}

function checkJsonSchema(output: string, schemaRaw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return ["输出不是合法 JSON"];
  }
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(schemaRaw) as Record<string, unknown>;
  } catch {
    return ["JSON Schema 不是合法 JSON"];
  }
  return compileSchema(schema)(value) ? [] : ["JSON Schema assertion failed"];
}
export function validateAssertions(assertions: Assertion[]) {
  for (const a of assertions) {
    if (a.type === "regex") assertRegex(a.value);
    if (a.type === "json_schema") {
      try {
        compileSchema(JSON.parse(a.value));
      } catch {
        throw badRequest("Invalid JSON Schema assertion");
      }
    }
  }
}
