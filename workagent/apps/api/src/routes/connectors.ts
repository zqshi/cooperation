import { sensitiveMutation, transactionOne } from "../lib/guards.js";
import type { FastifyInstance } from "fastify";
import {
  createConnectorSchema,
  updateConnectorSchema,
  type Connector,
  type ConnectorTool,
} from "@workagent/contracts";
import { audit as baseAudit, encryptSecret, notFound } from "@workagent/core";
import { one, query } from "@workagent/db";
import { badRequest } from "@workagent/core";
import { requireBuild } from "../lib/guards.js";

type ConnectorRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  type: "http" | "mcp";
  base_url: string | null;
  mcp_url: string | null;
  auth_type: Connector["authType"];
  secret_encrypted: string | null;
  status: Connector["status"];
  tools: ConnectorTool[];
  created_at: string;
  updated_at: string;
};

function mapConnector(row: ConnectorRow): Connector {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    baseUrl: row.base_url,
    mcpUrl: row.mcp_url,
    authType: row.auth_type,
    status: row.status,
    tools: row.tools,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateToolNames(tools: ConnectorTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw badRequest(`工具名称重复: ${tool.name}`);
    seen.add(tool.name);
  }
}

const audit = baseAudit;

export async function connectorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/connectors", async (request) => {
    const rows = await query<ConnectorRow>(
      "SELECT * FROM connector WHERE org_id = $1 AND status <> 'disabled' ORDER BY updated_at DESC",
      [request.user.orgId],
    );
    return {
      items: rows.map((row) => ({
        ...mapConnector(row),
        hasSecret: Boolean(row.secret_encrypted),
      })),
      total: rows.length,
    };
  });

  app.post("/connectors", async (request) => {
    return sensitiveMutation(request.user, "build", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireBuild(request.user);
      const input = createConnectorSchema.parse(request.body);
      if (input.type === "http" && !input.baseUrl)
        throw badRequest("HTTP Connector 需要 baseUrl");
      if (input.type === "mcp" && !input.mcpUrl)
        throw badRequest("MCP Connector 需要 mcpUrl");
      validateToolNames(input.tools);

      const row = await one<ConnectorRow>(
        `INSERT INTO connector
         (org_id, name, description, type, base_url, mcp_url, auth_type, secret_encrypted, status, tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::jsonb)
       RETURNING *`,
        [
          request.user.orgId,
          input.name,
          input.description,
          input.type,
          input.baseUrl ?? null,
          input.mcpUrl ?? null,
          input.authType,
          input.secret ? encryptSecret(input.secret) : null,
          JSON.stringify(input.tools),
        ],
      );
      if (!row) throw new Error("failed to create connector");
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "connector.create",
        resourceType: "connector",
        resourceId: row.id,
        metadata: { name: row.name, type: row.type },
        ip: request.ip,
      });
      return {
        connector: {
          ...mapConnector(row),
          hasSecret: Boolean(row.secret_encrypted),
        },
      };
    });
  });

  app.get("/connectors/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = await one<ConnectorRow>(
      "SELECT * FROM connector WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!row) throw notFound("Connector 不存在");
    return {
      connector: {
        ...mapConnector(row),
        hasSecret: Boolean(row.secret_encrypted),
      },
    };
  });

  app.patch("/connectors/:id", async (request) => {
    return sensitiveMutation(request.user, "build", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireBuild(request.user);
      const { id } = request.params as { id: string };
      const input = updateConnectorSchema.parse(request.body);
      const existing = await one<ConnectorRow>(
        "SELECT * FROM connector WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [id, request.user.orgId],
      );
      if (!existing) throw notFound("Connector 不存在");
      if (input.tools) validateToolNames(input.tools);

      const secret =
        input.secret === undefined
          ? existing.secret_encrypted
          : input.secret === ""
            ? null
            : encryptSecret(input.secret);

      const row = await one<ConnectorRow>(
        `UPDATE connector
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              type = COALESCE($4, type),
              base_url = COALESCE($5, base_url),
              mcp_url = COALESCE($6, mcp_url),
              auth_type = COALESCE($7, auth_type),
              secret_encrypted = $8,
              tools = COALESCE($9::jsonb, tools)
        WHERE id = $1 AND org_id = $10
        RETURNING *`,
        [
          id,
          input.name ?? null,
          input.description ?? null,
          input.type ?? null,
          input.baseUrl ?? null,
          input.mcpUrl ?? null,
          input.authType ?? null,
          secret,
          input.tools ? JSON.stringify(input.tools) : null,
          request.user.orgId,
        ],
      );
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "connector.update",
        resourceType: "connector",
        resourceId: id,
        ip: request.ip,
      });
      return {
        connector: row
          ? { ...mapConnector(row), hasSecret: Boolean(row.secret_encrypted) }
          : null,
      };
    });
  });

  app.delete("/connectors/:id", async (request) => {
    return sensitiveMutation(request.user, "build", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireBuild(request.user);
      const { id } = request.params as { id: string };
      const row = await one<ConnectorRow>(
        "UPDATE connector SET status = 'disabled' WHERE id = $1 AND org_id = $2 RETURNING *",
        [id, request.user.orgId],
      );
      if (!row) throw notFound("Connector 不存在");
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "connector.disable",
        resourceType: "connector",
        resourceId: id,
        ip: request.ip,
      });
      return { ok: true };
    });
  });
}
