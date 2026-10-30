import type { AuthUser } from "@workagent/core";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}
