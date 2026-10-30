import { config } from "@workagent/config";
import type { PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import {
  agentPreviewSchema,
  createAgentSchema,
  publishAgentSchema,
  updateAgentSchema,
  type AgentDefinition,
  type RuntimeBootstrapSnapshot,
  type ToolPlan,
} from "@workagent/contracts";
import {
  audit,
  compileAgent,
  notFound,
  previewAgent,
  conflict,
  canBuild,
} from "@workagent/core";
import { one, query, tx } from "@workagent/db";
import { requireBuild } from "../lib/guards.js";

type AgentRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  current_revision_id: string | null;
  published_version: number | null;
  visibility: string;
  created_by: string;
  personal_owner_id?: string | null;
  created_at: string;
  updated_at: string;
};

type RevisionRow = {
  id: string;
  agent_id: string;
  version: number;
  status: "draft" | "published" | "archived";
  definition: AgentDefinition;
  tool_plan: ToolPlan | null;
  bootstrap: RuntimeBootstrapSnapshot | null;
  changelog: string;
  created_by: string;
  created_at: string;
  published_at: string | null;
};

function mapAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    publishedVersion: row.published_version,
    visibility: row.visibility,
    personal: Boolean(row.personal_owner_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRevision(row: RevisionRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: row.version,
    status: row.status,
    definition: row.definition,
    toolPlan: row.tool_plan,
    bootstrap: row.bootstrap,
    changelog: row.changelog,
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

async function getAgentRow(
  agentId: string,
  orgId: string,
  client?: PoolClient,
  personalOwnerId?: string,
): Promise<AgentRow> {
  const oneLocal = client
    ? async <T>(sql: string, params: unknown[]) =>
        (await client.query(sql, params)).rows[0] as T | undefined
    : one;
  const row = await oneLocal<AgentRow>(
    "SELECT * FROM agent WHERE id = $1 AND org_id = $2 AND (personal_owner_id IS NULL OR personal_owner_id=$3)",
    [agentId, orgId, personalOwnerId ?? null],
  );
  if (!row) throw notFound("Agent 不存在");
  return row;
}

async function getDetail(
  agentId: string,
  orgId: string,
  client?: PoolClient,
  personalOwnerId?: string,
) {
  const agent = await getAgentRow(agentId, orgId, client, personalOwnerId);
  const queryLocal = client
    ? async <T>(sql: string, params: unknown[]) =>
        (await client.query(sql, params)).rows as T[]
    : query;
  const revisions = await queryLocal<RevisionRow>(
    "SELECT * FROM agent_revision WHERE agent_id = $1 ORDER BY version DESC",
    [agentId],
  );
  const draft =
    revisions.find((revision) => revision.status === "draft") ?? null;
  const published =
    revisions.find((revision) => revision.status === "published") ?? null;
  return {
    agent: mapAgent(agent),
    draft: draft ? mapRevision(draft) : null,
    published: published ? mapRevision(published) : null,
    revisions: revisions.map(mapRevision),
  };
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/agents", async (request) => {
    const { q, status, scope } = request.query as {
      q?: string;
      status?: string;
      scope?: string;
    };
    const conditions = [
      "org_id = $1",
      "(personal_owner_id IS NULL OR personal_owner_id=$2)",
      "(visibility!='private' OR created_by=$2 OR $3)",
    ];
    if (scope === "enterprise") conditions.push("personal_owner_id IS NULL");
    if (!canBuild(request.user)) conditions.push("status = 'published'");
    const params: unknown[] = [
      request.user.orgId,
      request.user.id,
      canBuild(request.user),
    ];
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR description ILIKE $${params.length})`,
      );
    }
    const rows = await query<AgentRow>(
      `SELECT * FROM agent WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT 200`,
      params,
    );
    return { items: rows.map(mapAgent), total: rows.length };
  });

  app.post("/agents", async (request) => {
    requireBuild(request.user);
    return tx(async (client) => {
      const query = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await client.query(sql, params)).rows as T[];
      const one = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await query<T>(sql, params))[0] ?? null;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,7))",
        [request.user.orgId],
      );

      const input = createAgentSchema.parse(request.body);
      const definition = input.definition;

      const created = await one<AgentRow>(
        `INSERT INTO agent (org_id, name, description, status, visibility, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       RETURNING *`,
        [
          request.user.orgId,
          definition.name,
          definition.description,
          definition.visibility,
          request.user.id,
        ],
      );
      if (!created) throw new Error("failed to create agent");

      const revision = await one<RevisionRow>(
        `INSERT INTO agent_revision (agent_id, version, status, definition, created_by)
       VALUES ($1, 1, 'draft', $2::jsonb, $3)
       RETURNING *`,
        [created.id, JSON.stringify(definition), request.user.id],
      );
      if (!revision) throw new Error("failed to create revision");

      await query("UPDATE agent SET current_revision_id = $2 WHERE id = $1", [
        created.id,
        revision.id,
      ]);
      await audit(
        {
          orgId: request.user.orgId,
          actorId: request.user.id,
          action: "agent.create",
          resourceType: "agent",
          resourceId: created.id,
          metadata: { name: definition.name },
          ip: request.ip,
        },
        client,
      );

      return getDetail(created.id, request.user.orgId, client);
    });
  });

  app.get("/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    const own = await one(
      'SELECT id,name,description,status,visibility,personal_profile AS profile,published_version AS "activeVersion" FROM agent WHERE id=$1 AND org_id=$2 AND personal_owner_id=$3',
      [id, request.user.orgId, request.user.id],
    );
    if (own)
      return getDetail(id, request.user.orgId, undefined, request.user.id);
    requireBuild(request.user);
    return getDetail(id, request.user.orgId);
  });

  app.put("/agents/:id", async (request) => {
    requireBuild(request.user);
    return tx(async (client) => {
      const query = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await client.query(sql, params)).rows as T[];
      const one = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await query<T>(sql, params))[0] ?? null;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,7))",
        [request.user.orgId],
      );

      const { id } = request.params as { id: string };
      const input = updateAgentSchema.parse(request.body);
      const agent = await getAgentRow(id, request.user.orgId, client);
      const definition = input.definition;

      const latest = await one<RevisionRow>(
        "SELECT * FROM agent_revision WHERE agent_id = $1 ORDER BY version DESC LIMIT 1",
        [id],
      );
      if (!latest) throw notFound("Agent 版本不存在");

      let revisionId = latest.id;
      if (latest.status === "draft") {
        await query(
          `UPDATE agent_revision SET definition = $2::jsonb, changelog = $3 WHERE id = $1`,
          [latest.id, JSON.stringify(definition), input.changelog],
        );
      } else {
        const created = await one<RevisionRow>(
          `INSERT INTO agent_revision (agent_id, version, status, definition, changelog, created_by)
         VALUES ($1, $2, 'draft', $3::jsonb, $4, $5)
         RETURNING *`,
          [
            id,
            latest.version + 1,
            JSON.stringify(definition),
            input.changelog,
            request.user.id,
          ],
        );
        if (!created) throw new Error("failed to create draft revision");
        revisionId = created.id;
        if (agent.status !== "published") {
          await query(
            "UPDATE agent SET current_revision_id = $2 WHERE id = $1",
            [agent.id, created.id],
          );
        }
      }

      await query(
        `UPDATE agent SET name = $2, description = $3, visibility = $4 WHERE id = $1 AND org_id = $5`,
        [
          id,
          definition.name,
          definition.description,
          definition.visibility,
          request.user.orgId,
        ],
      );

      await audit(
        {
          orgId: request.user.orgId,
          actorId: request.user.id,
          action: "agent.update",
          resourceType: "agent",
          resourceId: id,
          metadata: { revisionId },
          ip: request.ip,
        },
        client,
      );

      return getDetail(id, request.user.orgId, client);
    });
  });

  app.post("/agents/:id/publish", async (request) => {
    requireBuild(request.user);
    return tx(async (client) => {
      const query = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await client.query(sql, params)).rows as T[];
      const one = async <T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => (await query<T>(sql, params))[0] ?? null;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,7))",
        [request.user.orgId],
      );

      const { id } = request.params as { id: string };
      const input = publishAgentSchema.parse(request.body ?? {});
      await getAgentRow(id, request.user.orgId, client);

      const latest = await one<RevisionRow>(
        "SELECT * FROM agent_revision WHERE agent_id = $1 ORDER BY version DESC LIMIT 1",
        [id],
      );
      if (!latest) throw notFound("Agent 版本不存在");
      if (latest.status !== "draft") throw conflict("没有待发布的草稿版本");

      const compiled = await compileAgent({
        orgId: request.user.orgId,
        agentId: id,
        revisionId: latest.id,
        version: latest.version,
        definition: latest.definition,
      });

      if (config.isProd) {
        const passed = await one(
          "SELECT id FROM eval_run WHERE org_id=$1 AND agent_revision_id=$2 AND revision_checksum=$3 AND status='succeeded' AND total>0 AND failed=0 AND passed=total",
          [request.user.orgId, latest.id, compiled.bootstrap.checksum],
        );
        if (
          !passed &&
          !(
            input.overrideReason &&
            ["owner", "admin"].includes(request.user.role)
          )
        )
          throw conflict(
            "Production publication requires a passed evaluation of this exact revision or an audited administrator override",
          );
        if (!passed)
          await audit(
            {
              orgId: request.user.orgId,
              actorId: request.user.id,
              action: "agent.publish.override",
              resourceType: "agent",
              resourceId: id,
              metadata: {
                reason: input.overrideReason,
                checksum: compiled.bootstrap.checksum,
              },
            },
            client,
          );
      }

      await query(
        `UPDATE agent_revision
          SET status = 'published', tool_plan = $2::jsonb, bootstrap = $3::jsonb,
              changelog = CASE WHEN $4 = '' THEN changelog ELSE $4 END,
              published_at = now()
        WHERE id = $1`,
        [
          latest.id,
          JSON.stringify(compiled.toolPlan),
          JSON.stringify(compiled.bootstrap),
          input.changelog,
        ],
      );
      await query(
        `UPDATE agent_revision SET status = 'archived'
        WHERE agent_id = $1 AND status = 'published' AND id <> $2`,
        [id, latest.id],
      );
      await query(
        `UPDATE agent
          SET status = 'published', current_revision_id = $2,
              published_version = $3, name = $4, description = $5, visibility = $6
        WHERE id = $1`,
        [
          id,
          latest.id,
          latest.version,
          compiled.definition.name,
          compiled.definition.description,
          compiled.definition.visibility,
        ],
      );

      await audit(
        {
          orgId: request.user.orgId,
          actorId: request.user.id,
          action: "agent.publish",
          resourceType: "agent",
          resourceId: id,
          metadata: {
            version: latest.version,
            tools: compiled.toolPlan.tools.map((tool) => tool.name),
          },
          ip: request.ip,
        },
        client,
      );

      return getDetail(id, request.user.orgId, client);
    });
  });

  app.post("/agents/:id/preview", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const input = agentPreviewSchema.parse(request.body);
    const agent = await getAgentRow(id, request.user.orgId);
    const latest = await one<RevisionRow>(
      "SELECT * FROM agent_revision WHERE agent_id = $1 ORDER BY version DESC LIMIT 1",
      [id],
    );
    if (!latest) throw notFound("Agent 版本不存在");
    const definition = latest.definition;

    const previewRevisionId = latest.id;
    const compiled = await compileAgent({
      orgId: request.user.orgId,
      agentId: agent.id,
      revisionId: previewRevisionId,
      version: latest.version,
      definition,
    });
    const result = await previewAgent({
      bootstrap: compiled.bootstrap,
      message: input.message,
      orgId: request.user.orgId,
      userId: request.user.id,
      agentId: agent.id,
    });
    return {
      ...result,
      systemPrompt: compiled.bootstrap.systemPrompt,
      tools: compiled.toolPlan.tools.map((tool) => tool.name),
    };
  });

  app.delete("/agents/:id", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    await getAgentRow(id, request.user.orgId);
    await query(
      "UPDATE agent SET status = 'archived' WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    await audit({
      orgId: request.user.orgId,
      actorId: request.user.id,
      action: "agent.archive",
      resourceType: "agent",
      resourceId: id,
      ip: request.ip,
    });
    return { ok: true };
  });
}
