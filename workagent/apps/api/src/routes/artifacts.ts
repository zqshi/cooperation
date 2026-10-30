import type { FastifyInstance } from "fastify";
import { requireRunAccess, getObject, notFound } from "@workagent/core";
import { one } from "@workagent/db";

export async function artifactRoutes(app: FastifyInstance): Promise<void> {
  app.get("/artifacts/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await one<{
      id: string;
      name: string;
      mime_type: string;
      storage_key: string;
      size: number;
      user_id: string;
      run_id: string;
    }>(
      `SELECT ar.run_id, ar.id, ar.name, ar.mime_type, ar.storage_key, ar.size, r.user_id
         FROM artifact ar JOIN agent_run r ON r.id = ar.run_id
        WHERE ar.id = $1 AND r.org_id = $2`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("产物不存在");
    await requireRunAccess(request.user, row.run_id);

    const buffer = await getObject(row.storage_key);
    reply.header("Content-Type", row.mime_type);
    reply.header("Content-Length", buffer.byteLength);
    reply.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    return reply.send(buffer);
  });
}
