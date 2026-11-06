import { queueRoutes } from "./routes/queue.js";
import { query } from "@workagent/db";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { config } from "@workagent/config";
import {
  SESSION_COOKIE,
  PLATFORM_COOKIE,
  getPlatformSessionUser,
  getSessionUser,
  toErrorResponse,
  unauthorized,
  forbidden,
} from "@workagent/core";
import type { AuthUser } from "@workagent/core";
import { authRoutes } from "./routes/auth.js";
import { automationRoutes } from "./routes/automation.js";
import { personalRoutes } from "./routes/personal.js";
import { agentRoutes } from "./routes/agents.js";
import { skillRoutes } from "./routes/skills.js";
import { connectorRoutes } from "./routes/connectors.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { runRoutes } from "./routes/runs.js";
import { approvalRoutes } from "./routes/approvals.js";
import { evalRoutes } from "./routes/evals.js";
import { opsRoutes } from "./routes/ops.js";
import { channelRoutes } from "./routes/channels.js";
import { artifactRoutes } from "./routes/artifacts.js";
import { mockRoutes } from "./routes/mock.js";
import "./types.js";
import { requireBuild } from "./lib/guards.js";
import { platformRoutes } from "./routes/platform.js";
import { projectRoutes } from "./routes/projects.js";
import { managementRoutes } from "./routes/management.js";
import { modelRoutes } from './routes/models.js';
import {runtimeRegistryRoutes} from './routes/runtime-registry.js';
import {platformScheduleRoutes} from './routes/platform-schedules.js';
import {gatewayRoutes} from './routes/gateway.js';

const PUBLIC_PREFIXES = [
  "/v1/platform-auth/login",
  "/readyz",
  "/v1/auth/login",
  "/healthz",
  "/mock/",
];

function isPublic(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (
    PUBLIC_PREFIXES.some((prefix) =>
      prefix.endsWith("/")
        ? !config.isProd && path.startsWith(prefix)
        : path === prefix,
    )
  )
    return true;
  if (/^\/v1\/channels\/[^/]+\/[^/]+\/webhook$/.test(path)) return true;
  return false;
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}

export async function buildServer(
  options: { testRateLimitMax?: number } = {},
): Promise<FastifyInstance> {
  if (options.testRateLimitMax !== undefined && config.nodeEnv !== "test")
    throw new Error("Test rate limit override requires NODE_ENV=test");
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "password",
        "token",
        "secret",
        "apiKey",
      ],
      level: config.nodeEnv === "development" ? "info" : "warn",
    },
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: config.trustedProxy
      ? config.trustedProxy.split(",").map((v) => v.trim())
      : false,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    if (config.isProd)
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  await app.register(rateLimit, {
    max: options.testRateLimitMax ?? 120,
    timeWindow: "1 minute",
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: [config.consoleOrigin, config.userPortalOrigin],
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      (request as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook("onRequest", async (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        origin &&
        ![config.consoleOrigin, config.userPortalOrigin].includes(origin)
      )
        throw forbidden("Untrusted request origin");
      if (
        (request.cookies[SESSION_COOKIE] || request.cookies[PLATFORM_COOKIE]) &&
        !origin
      )
        throw forbidden("Cookie mutations require an Origin header");
    }
    if (
      (request.url.startsWith("/v1/platform/") ||
        request.url.startsWith("/v1/platform-auth/")) &&
      request.headers.origin &&
      request.headers.origin !== config.consoleOrigin
    )
      throw forbidden("Platform requests require the console origin");
    if (isPublic(request.url)) return;
    if (!request.url.startsWith("/v1/")) return;

    const token =
      request.cookies[SESSION_COOKIE] ??
      bearerToken(request.headers.authorization) ??
      undefined;
    const user =
      request.url.startsWith("/v1/platform/") ||
      request.url.startsWith("/v1/platform-auth/")
        ? await getPlatformSessionUser(
            request.cookies[PLATFORM_COOKIE] ??
              bearerToken(request.headers.authorization),
          )
        : await getSessionUser(token);
    if (!user) throw unauthorized();
    request.user = user;
    // Builder resource reads and writes share the tenant construction authorization boundary.
    const pathname = request.url.split("?")[0] ?? request.url;
    if (
      /^\/v1\/(skills|connectors|knowledge-spaces|documents|eval-datasets|eval-cases|eval-runs)(\/|$)/.test(
        pathname,
      )
    ) {
      requireBuild(user);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if ([413, 429].includes(statusCode))
      return reply.status(statusCode).send({
        error: {
          code: statusCode === 429 ? "rate_limited" : "payload_too_large",
          message: statusCode === 429 ? "请求过于频繁" : "上传超过限制",
          requestId: request.id,
        },
      });
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "请求参数不合法",
          details: error.flatten(),
          requestId: request.id,
        },
      });
    }
    const { status, body } = toErrorResponse(error);
    if (status >= 500)
      request.log.error(
        {
          name: error instanceof Error ? error.name : "unknown",
          requestId: request.id,
        },
        "request failed",
      );
    return reply.status(status).send({
      ...body,
      error: { ...body.error, requestId: request.id },
    });
  });

  app.get("/readyz", async () => {
    await query("SELECT 1");
    return { status: "ready" };
  });
  app.get("/healthz", async () => ({
    status: "ok" as const,
    version: "0.1.0",
    now: new Date().toISOString(),
  }));

  await app.register(platformRoutes, { prefix: "/v1/platform" });
  await app.register(managementRoutes, { prefix: "/v1" });
  await app.register(modelRoutes, { prefix: '/v1' });
  await app.register(runtimeRegistryRoutes,{prefix:'/v1/platform'});
  await app.register(platformScheduleRoutes,{prefix:'/v1/platform'});
  await app.register(gatewayRoutes,{prefix:'/v1/platform'});
  await app.register(queueRoutes, { prefix: "/v1" });
  await app.register(projectRoutes, { prefix: "/v1" });
  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(personalRoutes, { prefix: "/v1" });
  await app.register(automationRoutes, { prefix: "/v1" });
  await app.register(agentRoutes, { prefix: "/v1" });
  await app.register(skillRoutes, { prefix: "/v1" });
  await app.register(connectorRoutes, { prefix: "/v1" });
  await app.register(knowledgeRoutes, { prefix: "/v1" });
  await app.register(runRoutes, { prefix: "/v1" });
  await app.register(approvalRoutes, { prefix: "/v1" });
  await app.register(evalRoutes, { prefix: "/v1" });
  await app.register(opsRoutes, { prefix: "/v1" });
  await app.register(channelRoutes, { prefix: "/v1" });
  await app.register(artifactRoutes, { prefix: "/v1" });
  if (!config.isProd) await app.register(mockRoutes, { prefix: "/mock" });

  return app;
}

export type { AuthUser };
