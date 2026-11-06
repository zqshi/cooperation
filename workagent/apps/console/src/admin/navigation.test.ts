import { describe, expect, it } from "vitest";
import {
  platformNavigation,
  platformRoutes,
  tenantNavigation,
  tenantRoutes,
} from "./navigation.js";

describe("admin navigation and route manifest", () => {
  it("preserves platform navigation groups and destinations", () => {
    expect(platformNavigation.map((group) => [group.label, group.items.map((item) => item.label)])).toEqual([
      ["总览", ["平台总览"]],
      ["租户与目录", ["租户管理", "服务连接器", "数据字典"]],
      ["运行与调度", ["运行环境", "Profiles", "网关控制", "定时任务"]],
      ["观测", ["监控大盘"]],
      ["平台治理", ["审计日志"]],
    ]);
  });

  it("preserves tenant navigation groups and destinations", () => {
    expect(tenantNavigation.map((group) => [group.label, group.items.map((item) => item.label)])).toEqual([
      ["总览", ["租户总览"]],
      ["智能体与依赖", ["智能体", "技能", "模型", "知识库", "连接器目录"]],
      ["运行与渠道", ["应用渠道", "运行时", "控制中心"]],
      ["观测", ["链路追踪", "评测"]],
      ["运营", ["内容管理", "业务统计", "功能统计"]],
      ["平台设置", ["授权管理", "开通管理", "平台用户", "审计日志"]],
    ]);
  });

  it("binds every visible navigation destination to a page route", () => {
    const platformPaths = new Set(platformRoutes.filter((route) => !route.redirect).map((route) => route.path));
    const tenantPaths = new Set(tenantRoutes.filter((route) => !route.redirect).map((route) => route.path));
    for (const group of platformNavigation) for (const item of group.items) expect(platformPaths.has(item.path)).toBe(true);
    for (const group of tenantNavigation) for (const item of group.items) expect(tenantPaths.has(item.path)).toBe(true);
  });

  it("includes all detail, import, drill-down and legacy deep links", () => {
    const platform = platformRoutes.map((route) => route.path);
    const tenant = tenantRoutes.map((route) => route.path);
    expect(platform).toEqual(expect.arrayContaining([
      "/super-admin/connectors/import",
      "/super-admin/runtime-images/kind/:kind",
      "/super-admin/profiles/config/:kind",
      "/super-admin/scheduled-tasks/tasks/:taskId",
      "/super-admin/scheduled-tasks/runs/:runId",
      "/super-admin/scheduled-tasks/executions/:ownerKind/:date",
      "/super-admin/audit-logs",
    ]));
    expect(tenant).toEqual(expect.arrayContaining([
      "/tenant/runtimes-v2/environments/:envId",
      "/tenant/runtimes/:id/console",
      "/tenant/control-center/template-rollouts/:rolloutId",
      "/tenant/traces/:traceId",
      "/tenant/data-platform/traces/:traceId",
      "/tenant/data-platform/skills",
      "/tenant/data-platform/agents",
      "/tenant/content/new",
      "/tenant/content/:slug/detail",
      "/tenant/content/:slug",
      "/tenant/card-templates",
      "/tenant/distribution/channels",
      "/tenant/knowledge/create",
      "/tenant/knowledge/:spaceId/documents/:documentId",
      "/tenant/wps-app-pool/apps/:resourceId",
      "/tenant/provisioning",
    ]));
  });
});
