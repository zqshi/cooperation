import { z } from "zod";
import { taskInputSchema, taskUpdateSchema } from "@workagent/contracts";
import {
  listProjectTasks,
  listProjectActivity,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  removeProjectMember,
  startTaskAttempt,
  taskReferences,
} from "@workagent/core";
import type { FastifyInstance } from "fastify";
import {
  createProjectSchema,
  projectMemberInputSchema,
} from "@workagent/contracts";
import {
  projectExecution,
  createProject,
  listProjects,
  requireProjectAccess,
  listProjectMembers,
  listProjectCandidates,
  setProjectMember,
} from "@workagent/core";

export async function projectRoutes(app: FastifyInstance) {
  for (const kind of ["runs", "artifacts", "approvals"] as const) {
    app.get<{ Params: { id: string } }>(
      `/projects/:id/${kind}`,
      async (req) => {
        const paging = z
          .object({
            page: z.coerce.number().int().min(1).max(100000).default(1),
            pageSize: z.coerce.number().int().min(1).max(100).default(20),
          })
          .parse(req.query);
        return projectExecution(
          req.user,
          req.params.id,
          kind,
          paging.page,
          paging.pageSize,
        );
      },
    );
  }
  app.get<{ Params: { id: string } }>(
    "/projects/:id/activity",
    async (req) => ({
      items: await listProjectActivity(req.user, req.params.id),
    }),
  );
  app.get<{ Params: { id: string } }>("/projects/:id/tasks", async (req) => ({
    items: await listProjectTasks(req.user, req.params.id),
  }));
  app.post<{ Params: { id: string } }>(
    "/projects/:id/tasks",
    async (req, reply) =>
      reply.code(201).send({
        task: await createProjectTask(
          req.user,
          req.params.id,
          taskInputSchema.parse(req.body),
        ),
      }),
  );
  app.patch<{ Params: { id: string; taskId: string } }>(
    "/projects/:id/tasks/:taskId",
    async (req) => ({
      task: await updateProjectTask(
        req.user,
        req.params.id,
        req.params.taskId,
        taskUpdateSchema.parse(req.body),
      ),
    }),
  );
  app.delete<{ Params: { id: string; taskId: string } }>(
    "/projects/:id/tasks/:taskId",
    async (req) => {
      await deleteProjectTask(req.user, req.params.id, req.params.taskId);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string; userId: string } }>(
    "/projects/:id/members/:userId",
    async (req) => {
      await removeProjectMember(req.user, req.params.id, req.params.userId);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/projects/:id/transfer",
    async (req) => {
      await removeProjectMember(
        req.user,
        req.params.id,
        z
          .object({ userId: z.string().min(1) })
          .strict()
          .parse(req.body).userId,
        true,
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string; taskId: string } }>(
    "/projects/:id/tasks/:taskId/attempts",
    async (req) =>
      startTaskAttempt(
        req.user,
        req.params.id,
        req.params.taskId,
        z
          .object({ key: z.string().min(1).max(100) })
          .strict()
          .parse(req.body).key,
      ),
  );
  app.get<{ Params: { id: string; taskId: string } }>(
    "/projects/:id/tasks/:taskId/references",
    async (req) => taskReferences(req.user, req.params.id, req.params.taskId),
  );
  app.post<{ Params: { id: string; taskId: string } }>(
    "/projects/:id/tasks/:taskId/references",
    async (req) =>
      taskReferences(
        req.user,
        req.params.id,
        req.params.taskId,
        z
          .object({ artifactId: z.string().min(1) })
          .strict()
          .parse(req.body).artifactId,
      ),
  );
  app.get("/projects", async (req) => {
    const items = await listProjects(req.user);
    return { items, total: items.length };
  });
  app.post("/projects", async (req, reply) => {
    const project = await createProject(
      req.user,
      createProjectSchema.parse(req.body),
    );
    return reply.code(201).send({ project });
  });
  app.get<{ Params: { id: string } }>("/projects/:id", async (req) => ({
    project: await requireProjectAccess(req.user, req.params.id),
  }));
  app.get<{ Params: { id: string } }>("/projects/:id/members", async (req) => ({
    items: await listProjectMembers(req.user, req.params.id),
  }));
  app.get<{ Params: { id: string } }>(
    "/projects/:id/candidates",
    async (req) => ({
      items: await listProjectCandidates(req.user, req.params.id),
    }),
  );
  app.put<{ Params: { id: string } }>("/projects/:id/members", async (req) => {
    await setProjectMember(
      req.user,
      req.params.id,
      projectMemberInputSchema.parse(req.body),
    );
    return { ok: true };
  });
}
