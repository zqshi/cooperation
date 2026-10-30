import type { FastifyInstance } from "fastify";
import {
  createKnowledgeSpaceSchema,
  searchKnowledgeSchema,
  type KnowledgeSpace,
} from "@workagent/contracts";
import {
  audit,
  notFound,
  putObject,
  badRequest,
  objectKey,
  retrieve,
  deleteObject,
  enqueue,
  enqueueWithClient,
} from "@workagent/core";
import { one, query, tx } from "@workagent/db";
import { requireBuild } from "../lib/guards.js";

type SpaceRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  embedding_model: string;
  created_at: string;
  updated_at: string;
};

type DocumentRow = {
  id: string;
  space_id: string;
  name: string;
  mime_type: string;
  size: number;
  storage_key: string;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunk_count: number;
  created_at: string;
};

function mapSpace(row: SpaceRow, documentCount = 0): KnowledgeSpace {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    embeddingModel: row.embedding_model,
    documentCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row: DocumentRow) {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    status: row.status,
    error: row.error,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
  };
}

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/knowledge-spaces", async (request) => {
    const rows = await query<SpaceRow & { document_count: string }>(
      `SELECT s.*, (SELECT COUNT(*)::text FROM document d WHERE d.space_id = s.id) AS document_count
         FROM knowledge_space s
        WHERE s.org_id = $1
        ORDER BY s.updated_at DESC`,
      [request.user.orgId],
    );
    return {
      items: rows.map((row) => mapSpace(row, Number(row.document_count))),
      total: rows.length,
    };
  });

  app.post("/knowledge-spaces", async (request) => {
    requireBuild(request.user);
    const input = createKnowledgeSpaceSchema.parse(request.body);
    const row = await one<SpaceRow>(
      `INSERT INTO knowledge_space (org_id, name, description, embedding_model)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [request.user.orgId, input.name, input.description, input.embeddingModel],
    );
    if (!row) throw new Error("failed to create knowledge space");
    await audit({
      orgId: request.user.orgId,
      actorId: request.user.id,
      action: "knowledge_space.create",
      resourceType: "knowledge_space",
      resourceId: row.id,
      ip: request.ip,
    });
    return { space: mapSpace(row) };
  });

  app.get("/knowledge-spaces/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = await one<SpaceRow & { document_count: string }>(
      `SELECT s.*, (SELECT COUNT(*)::text FROM document d WHERE d.space_id = s.id) AS document_count
         FROM knowledge_space s WHERE s.id = $1 AND s.org_id = $2`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("知识库不存在");
    return { space: mapSpace(row, Number(row.document_count)) };
  });

  app.patch("/knowledge-spaces/:id", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const input = createKnowledgeSpaceSchema.partial().parse(request.body);
    const row = await one<SpaceRow>(
      `UPDATE knowledge_space
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              embedding_model = COALESCE($4, embedding_model)
        WHERE id = $1 AND org_id = $5
        RETURNING *`,
      [
        id,
        input.name ?? null,
        input.description ?? null,
        input.embeddingModel ?? null,
        request.user.orgId,
      ],
    );
    if (!row) throw notFound("知识库不存在");
    return { space: mapSpace(row) };
  });

  app.delete("/knowledge-spaces/:id", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const row = await one<SpaceRow>(
      "DELETE FROM knowledge_space WHERE id = $1 AND org_id = $2 RETURNING *",
      [id, request.user.orgId],
    );
    if (!row) throw notFound("知识库不存在");
    await audit({
      orgId: request.user.orgId,
      actorId: request.user.id,
      action: "knowledge_space.delete",
      resourceType: "knowledge_space",
      resourceId: id,
      ip: request.ip,
    });
    return { ok: true };
  });

  app.get("/knowledge-spaces/:id/documents", async (request) => {
    const { id } = request.params as { id: string };
    const space = await one<SpaceRow>(
      "SELECT * FROM knowledge_space WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!space) throw notFound("知识库不存在");
    const rows = await query<DocumentRow>(
      "SELECT * FROM document WHERE space_id = $1 ORDER BY created_at DESC",
      [id],
    );
    return { items: rows.map(mapDocument), total: rows.length };
  });

  app.post("/knowledge-spaces/:id/documents", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const space = await one<SpaceRow>(
      "SELECT * FROM knowledge_space WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!space) throw notFound("知识库不存在");

    const file = await request.file();
    if (!file) throw notFound("未收到文件");
    const allowed = new Set([
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    if (!allowed.has(file.mimetype))
      throw badRequest("Unsupported document type");
    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) throw notFound("文件为空");

    const key = objectKey(`knowledge/${space.id}`, file.filename);
    await putObject(key, buffer, file.mimetype);
    try {
      return await tx(async (client) => {
        const one = async <T>(sql: string, params: unknown[]) =>
          (await client.query(sql, params)).rows[0] as T | undefined;
        const document = await one<DocumentRow>(
          `INSERT INTO document (space_id, name, mime_type, size, storage_key, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
          [
            space.id,
            file.filename,
            file.mimetype || "application/octet-stream",
            buffer.byteLength,
            key,
          ],
        );
        if (!document) throw new Error("failed to create document");

        await enqueueWithClient(client, {
          orgId: request.user.orgId,
          type: "document.ingest",
          payload: { documentId: document.id },
        });
        await audit(
          {
            orgId: request.user.orgId,
            actorId: request.user.id,
            action: "document.upload",
            resourceType: "document",
            resourceId: document.id,
            metadata: {
              spaceId: space.id,
              name: file.filename,
              size: buffer.byteLength,
            },
            ip: request.ip,
          },
          client,
        );
        return { document: mapDocument(document) };
      });
    } catch (error) {
      await deleteObject(key).catch(() => undefined);
      throw error;
    }
  });

  app.post("/documents/:id/reindex", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const row = await one<DocumentRow & { org_id: string }>(
      `SELECT d.*, s.org_id FROM document d JOIN knowledge_space s ON s.id = d.space_id
        WHERE d.id = $1 AND s.org_id = $2`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("文档不存在");
    await query(
      "UPDATE document SET status = 'pending', error = NULL WHERE id = $1",
      [id],
    );
    await enqueue({
      orgId: request.user.orgId,
      type: "document.ingest",
      payload: { documentId: id },
    });
    return { ok: true };
  });

  app.delete("/documents/:id", async (request) => {
    requireBuild(request.user);
    const { id } = request.params as { id: string };
    const row = await one<DocumentRow>(
      `DELETE FROM document d USING knowledge_space s
        WHERE d.id = $1 AND s.id = d.space_id AND s.org_id = $2
        RETURNING d.*`,
      [id, request.user.orgId],
    );
    if (!row) throw notFound("文档不存在");
    await deleteObject(row.storage_key).catch(() => undefined);
    await audit({
      orgId: request.user.orgId,
      actorId: request.user.id,
      action: "document.delete",
      resourceType: "document",
      resourceId: id,
      ip: request.ip,
    });
    return { ok: true };
  });

  app.post("/knowledge-spaces/:id/search", async (request) => {
    const { id } = request.params as { id: string };
    const space = await one<SpaceRow>(
      "SELECT * FROM knowledge_space WHERE id = $1 AND org_id = $2",
      [id, request.user.orgId],
    );
    if (!space) throw notFound("知识库不存在");
    const input = searchKnowledgeSchema.parse(request.body);
    const chunks = await retrieve(
      [id],
      input.query,
      input.topK,
      input.minScore,
      request.user.orgId,
    );
    return { chunks };
  });
}
