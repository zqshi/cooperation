import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  saveAutomation,
  automationAction,
  triggerAutomation,
  readAutomations,
  automationHistory,
} from "@workagent/core";
const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export async function automationRoutes(app: FastifyInstance) {
  app.get("/automations", async (req) => {
    const p = paging.parse(req.query);
    return readAutomations(req.user, undefined, p.page, p.pageSize);
  });
  app.post("/automations", async (req) => saveAutomation(req.user, req.body));
  app.get<{ Params: { id: string } }>("/automations/:id", async (req) =>
    readAutomations(req.user, req.params.id),
  );
  app.put<{ Params: { id: string } }>("/automations/:id", async (req) =>
    saveAutomation(req.user, req.body, req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/automations/:id/actions",
    async (req) => automationAction(req.user, req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>(
    "/automations/:id/trigger",
    async (req) => {
      const data = z.object({ key: z.string() }).strict().parse(req.body);
      return triggerAutomation(req.user, req.params.id, data.key);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/automations/:id/history",
    async (req) => {
      const p = paging.parse(req.query);
      return automationHistory(req.user, req.params.id, p.page, p.pageSize);
    },
  );
}
