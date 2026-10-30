import { sensitiveMutation, transactionOne } from "../lib/guards.js";
import type { FastifyInstance } from "fastify";
import {
  createSkillSchema,
  updateSkillSchema,
  type Skill,
} from "@workagent/contracts";
import { audit as baseAudit, notFound } from "@workagent/core";
import { one, query } from "@workagent/db";
import { requireBuild } from "../lib/guards.js";

type SkillRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  instructions: string;
  version: number;
  status: Skill["status"];
  visibility: Skill["visibility"];
  created_at: string;
  updated_at: string;
};

function mapSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    version: row.version,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const audit = baseAudit;

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  app.get("/skills", async (request) => {
    const rows = await query<SkillRow>(
      "SELECT * FROM skill WHERE org_id = $1 AND status <> 'archived' ORDER BY updated_at DESC",
      [request.user.orgId],
    );
    return { items: rows.map(mapSkill), total: rows.length };
  });

  app.post("/skills", async (request) => {
    return sensitiveMutation(request.user, "build", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireBuild(request.user);
      const input = createSkillSchema.parse(request.body);
      const row = await one<SkillRow>(
        `INSERT INTO skill (org_id, name, description, instructions, version, status, visibility)
       VALUES ($1, $2, $3, $4, 1, 'active', $5)
       RETURNING *`,
        [
          request.user.orgId,
          input.name,
          input.description,
          input.instructions,
          input.visibility,
        ],
      );
      if (!row) throw new Error("failed to create skill");
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "skill.create",
        resourceType: "skill",
        resourceId: row.id,
        metadata: { name: row.name },
        ip: request.ip,
      });
      return { skill: mapSkill(row) };
    });
  });

  app.get("/skills/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = await one<SkillRow>(
      "SELECT * FROM skill WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!row) throw notFound("Skill 不存在");
    return { skill: mapSkill(row) };
  });

  app.patch("/skills/:id", async (request) => {
    return sensitiveMutation(request.user, "build", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireBuild(request.user);
      const { id } = request.params as { id: string };
      const input = updateSkillSchema.parse(request.body);
      const existing = await one<SkillRow>(
        "SELECT * FROM skill WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [id, request.user.orgId],
      );
      if (!existing) throw notFound("Skill 不存在");

      const row = await one<SkillRow>(
        `UPDATE skill
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              instructions = COALESCE($4, instructions),
              visibility = COALESCE($5, visibility),
              version = version + 1
        WHERE id = $1 AND org_id = $6
        RETURNING *`,
        [
          id,
          input.name ?? null,
          input.description ?? null,
          input.instructions ?? null,
          input.visibility ?? null,
          request.user.orgId,
        ],
      );
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "skill.update",
        resourceType: "skill",
        resourceId: id,
        ip: request.ip,
      });
      return { skill: row ? mapSkill(row) : null };
    });
  });

  app.delete("/skills/:id", async (request) => {
    return sensitiveMutation(request.user, "build", async (client) => {
      const one = transactionOne(client);
      const audit = (input: Parameters<typeof baseAudit>[0]) =>
        baseAudit(input, client);
      requireBuild(request.user);
      const { id } = request.params as { id: string };
      const row = await one<SkillRow>(
        "UPDATE skill SET status = 'archived' WHERE id = $1 AND org_id = $2 RETURNING *",
        [id, request.user.orgId],
      );
      if (!row) throw notFound("Skill 不存在");
      await audit({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "skill.archive",
        resourceType: "skill",
        resourceId: id,
        ip: request.ip,
      });
      return { ok: true };
    });
  });
}
