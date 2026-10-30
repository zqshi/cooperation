import { parseDocument } from "./document-parse.js";
import { query, one, tx } from "@workagent/db";
import type { RetrievedChunk } from "@workagent/contracts";
import { embedTexts, vectorLiteral } from "./model.js";
import { getObject } from "./storage.js";
import { badRequest, notFound } from "./errors.js";

export type DocumentRow = {
  id: string;
  space_id: string;
  name: string;
  mime_type: string;
  storage_key: string;
  status: string;
};

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();
  if (
    mimeType === "text/html" ||
    lower.endsWith(".html") ||
    lower.endsWith(".htm")
  ) {
    return stripHtml(buffer.toString("utf8"));
  }
  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    return buffer.toString("utf8");
  }
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return parseDocument(buffer, "pdf");
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return parseDocument(buffer, "docx");
  }
  if (mimeType.includes("json") || lower.endsWith(".json")) {
    return buffer.toString("utf8");
  }
  throw badRequest(`暂不支持解析该文件类型: ${mimeType || fileName}`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function chunkText(
  text: string,
  maxChars = 1200,
  overlap = 150,
): string[] {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return [];

  const segmenter = new Intl.Segmenter("zh", { granularity: "sentence" });
  const sentences = Array.from(segmenter.segment(cleaned), (item) =>
    item.segment.trim(),
  ).filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars - overlap) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + sentence.length + 1 > maxChars) {
      chunks.push(current);
      const tail = current.slice(-overlap);
      current = `${tail}${tail ? "\n" : ""}${sentence}`;
    } else {
      current = current ? `${current}\n${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((chunk) => chunk.length > 20).slice(0, 500);
}

export async function ingestDocument(
  documentId: string,
): Promise<{ chunks: number }> {
  const doc = await one<DocumentRow>(
    "SELECT id, space_id, name, mime_type, storage_key, status FROM document WHERE id = $1",
    [documentId],
  );
  if (!doc) throw notFound("文档不存在");

  await query(
    "UPDATE document SET status = 'processing', error = NULL WHERE id = $1",
    [documentId],
  );

  try {
    const buffer = await getObject(doc.storage_key);
    const text = await extractText(buffer, doc.mime_type, doc.name);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw badRequest("文档没有可索引的文本内容");

    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 16) {
      const batch = chunks.slice(i, i + 16);
      embeddings.push(...(await embedTexts(batch)));
    }

    await tx(async (client) => {
      await client.query("DELETE FROM chunk WHERE document_id = $1", [
        documentId,
      ]);
      for (let i = 0; i < chunks.length; i += 1) {
        await client.query(
          `INSERT INTO chunk (document_id, space_id, seq, content, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)`,
          [
            documentId,
            doc.space_id,
            i,
            chunks[i],
            vectorLiteral(embeddings[i] ?? []),
            JSON.stringify({ source: doc.name }),
          ],
        );
      }
      await client.query(
        "UPDATE document SET status = 'ready', chunk_count = $2, error = NULL WHERE id = $1",
        [documentId, chunks.length],
      );
    });

    return { chunks: chunks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      "UPDATE document SET status = 'failed', error = $2 WHERE id = $1",
      [documentId, "Document ingestion failed"],
    );
    throw error;
  }
}

export async function retrieve(
  spaceIds: string[],
  queryText: string,
  topK = 5,
  minScore = 0.2,
  orgId?: string,
): Promise<RetrievedChunk[]> {
  if (!orgId)
    throw new Error("Knowledge retrieval requires enterprise identity");
  if (spaceIds.length === 0 || !queryText.trim()) return [];
  const [vector] = await embedTexts([queryText]);
  if (!vector) return [];

  const rows = await query<{
    chunk_id: string;
    document_id: string;
    document_name: string;
    content: string;
    score: number;
  }>(
    `SELECT * FROM (
       SELECT c.id AS chunk_id, c.document_id, d.name AS document_name, c.content,
              1 - (c.embedding <=> $1::vector) AS score
         FROM chunk c
         JOIN document d ON d.id = c.document_id
        WHERE c.space_id = ANY($2::text[]) AND d.status = 'ready' AND d.org_id=$5
        ORDER BY c.embedding <=> $1::vector
        LIMIT $3
     ) ranked
     WHERE score >= $4`,
    [vectorLiteral(vector), spaceIds, Math.max(topK * 3, 10), minScore, orgId],
  );

  return rows.slice(0, topK).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentName: row.document_name,
    content: row.content,
    score: Number(row.score),
  }));
}

export function buildKnowledgePrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  const items = chunks.map(
    (chunk, index) =>
      `[${index + 1}] 来源：${chunk.documentName}（相关度 ${chunk.score.toFixed(2)}）\n${chunk.content}`,
  );
  return `【知识库检索结果】\n${items.join("\n\n")}`;
}
