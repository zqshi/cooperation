import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, query, tx } from "@workagent/db";
import { forbidden, notFound, conflict } from "@workagent/core";
import { requireManage, sensitiveMutation } from "../lib/guards.js";
const idSchema = z.object({ id: z.string().uuid() });
const dictSchema = z
  .object({
    category: z.string().trim().min(1).max(80),
    code: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_.-]{1,80}$/),
    label: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
    sortOrder: z.number().int().min(-10000).max(10000).default(0),
    enabled: z.boolean().default(true),
  })
  .strict();
const contentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/),
    body: z.string().max(200000),
    summary: z.string().max(2000).default(""),
    status: z.enum(["draft", "published", "archived"]).default("draft"),
  })
  .strict();
export async function managementRoutes(app: FastifyInstance) {
  app.get("/platform/dicts", async (request) => {
    if (
      !(await one("SELECT user_id FROM platform_admin WHERE user_id=$1", [
        request.user.id,
      ]))
    )
      throw forbidden();
    const { search } = z
      .object({ search: z.string().max(120).default("") })
      .parse(request.query);
    return {
      items: await query(
        'SELECT id,category,code,label,description,sort_order AS "sortOrder",enabled FROM platform_dictionary WHERE strpos(lower(category||label||code),lower($1))>0 ORDER BY category,sort_order,code LIMIT 500',
        [search],
      ),
    };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: method === "POST" ? "/platform/dicts" : "/platform/dicts/:id",
      handler: async (request, reply) => {
        const input = dictSchema.parse(request.body);
        const id = method === "PUT" ? idSchema.parse(request.params).id : null;
        return tx(async (c) => {
          if (
            !(
              await c.query(
                "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
                [request.user.id],
              )
            ).rowCount
          )
            throw forbidden();
          let row;
          try {
            row = id
              ? (
                  await c.query(
                    "UPDATE platform_dictionary SET category=$2,code=$3,label=$4,description=$5,sort_order=$6,enabled=$7,updated_at=now() WHERE id=$1 RETURNING id",
                    [
                      id,
                      input.category,
                      input.code,
                      input.label,
                      input.description,
                      input.sortOrder,
                      input.enabled,
                    ],
                  )
                ).rows[0]
              : (
                  await c.query(
                    "INSERT INTO platform_dictionary(category,code,label,description,sort_order,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
                    [
                      input.category,
                      input.code,
                      input.label,
                      input.description,
                      input.sortOrder,
                      input.enabled,
                    ],
                  )
                ).rows[0];
          } catch (e) {
            if ((e as { code?: string }).code === "23505")
              throw conflict("分类下编码已存在");
            throw e;
          }
          if (!row) throw notFound();
          await c.query(
            "INSERT INTO platform_audit(user_id,action,metadata) VALUES($1,'dictionary.save',$2)",
            [request.user.id, JSON.stringify({ id: row.id, ...input })],
          );
          if (!id) reply.code(201);
          return { item: { id: row.id, ...input } };
        });
      },
    });
  app.get("/management/content", async (request) => {
    requireManage(request.user);
    return {
      items: await query(
        'SELECT id,title,slug,summary,status,version,published_at AS "publishedAt",updated_at AS "updatedAt" FROM managed_content WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 200',
        [request.user.orgId],
      ),
    };
  });
  app.get("/management/content/:id", async (request) => {
    requireManage(request.user);
    const { id } = idSchema.parse(request.params);
    const item = await one(
      "SELECT * FROM managed_content WHERE id=$1 AND org_id=$2",
      [id, request.user.orgId],
    );
    if (!item) throw notFound();
    return {
      item,
      revisions: await query(
        "SELECT version,title,status,created_at FROM managed_content_revision WHERE content_id=$1 AND org_id=$2 ORDER BY version DESC",
        [id, request.user.orgId],
      ),
    };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url:
        method === "POST" ? "/management/content" : "/management/content/:id",
      handler: async (request, reply) => {
        const body = z
          .object({
            content: contentSchema,
            expectedVersion: z.number().int().min(1).optional(),
          })
          .strict()
          .parse(request.body);
        const input = body.content;
        const id = method === "PUT" ? idSchema.parse(request.params).id : null;
        return sensitiveMutation(request.user, "manage", async (c) => {
          const existing = id
            ? (
                await c.query<{ version: number }>(
                  "SELECT version FROM managed_content WHERE id=$1 AND org_id=$2 FOR UPDATE",
                  [id, request.user.orgId],
                )
              ).rows[0]
            : null;
          if (id && !existing) throw notFound();
          if (existing && existing.version !== body.expectedVersion)
            throw conflict("内容已被其他人更新，请刷新");
          let item;
          try {
            item = id
              ? (
                  await c.query(
                    "UPDATE managed_content SET title=$3,slug=$4,body=$5,summary=$6,status=$7,version=version+1,published_at=CASE WHEN $7='published' THEN coalesce(published_at,now()) ELSE NULL END,updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *",
                    [
                      id,
                      request.user.orgId,
                      input.title,
                      input.slug,
                      input.body,
                      input.summary,
                      input.status,
                    ],
                  )
                ).rows[0]
              : (
                  await c.query(
                    "INSERT INTO managed_content(org_id,title,slug,body,summary,status,created_by,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6='published' THEN now() ELSE NULL END) RETURNING *",
                    [
                      request.user.orgId,
                      input.title,
                      input.slug,
                      input.body,
                      input.summary,
                      input.status,
                      request.user.id,
                    ],
                  )
                ).rows[0];
          } catch (e) {
            if ((e as { code?: string }).code === "23505")
              throw conflict("内容路径已存在");
            throw e;
          }
          await c.query(
            "INSERT INTO managed_content_revision(content_id,org_id,version,title,body,summary,status,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              item.id,
              request.user.orgId,
              item.version,
              input.title,
              input.body,
              input.summary,
              input.status,
              request.user.id,
            ],
          );
          await c.query(
            "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'content.save','content',$3,$4)",
            [
              request.user.orgId,
              request.user.id,
              item.id,
              JSON.stringify({ version: item.version, status: item.status }),
            ],
          );
          if (!id) reply.code(201);
          return { item };
        });
      },
    });
}
