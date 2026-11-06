import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Cpu,
  Database,
  FileText,
  KeyRound,
  LayoutDashboard,
  Network,
  Plug,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Users,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type AdminShell = "platform" | "tenant";
export type AdminPageId =
  | "platform-overview"
  | "tenants"
  | "connector-catalog"
  | "connector-import"
  | "dictionary"
  | "runtime-catalog"
  | "runtime-category"
  | "profiles"
  | "profile-kind"
  | "gateway"
  | "schedules"
  | "schedule-task"
  | "schedule-run"
  | "schedule-batch"
  | "platform-observability"
  | "platform-audit"
  | "tenant-overview"
  | "agents"
  | "agent-detail"
  | "skills"
  | "models"
  | "knowledge"
  | "knowledge-create"
  | "knowledge-detail"
  | "knowledge-document"
  | "connectors"
  | "channels"
  | "runtime-instances"
  | "runtime-console"
  | "runtime-environment-category"
  | "runtime-scenario-category"
  | "runtime-environment"
  | "control-center"
  | "rollout-detail"
  | "traces"
  | "trace-detail"
  | "evaluations"
  | "content"
  | "content-editor"
  | "content-detail"
  | "content-analytics"
  | "card-templates"
  | "distribution-channels"
  | "business-analytics"
  | "skill-analytics"
  | "agent-analytics"
  | "feature-usage"
  | "authorization"
  | "provisioning"
  | "wps-app-detail"
  | "tenant-users"
  | "tenant-audit";

export type AdminNavigationItem = {
  label: string;
  path: string;
  pageId: AdminPageId;
  icon: LucideIcon;
  gated?: "observability";
};

export type AdminNavigationGroup = {
  label: string;
  items: AdminNavigationItem[];
};

export type AdminRoute = {
  path: string;
  pageId?: AdminPageId;
  redirect?: string;
  shell: AdminShell;
};

export const platformNavigation: AdminNavigationGroup[] = [
  { label: "总览", items: [{ label: "平台总览", path: "/super-admin", pageId: "platform-overview", icon: LayoutDashboard }] },
  { label: "租户与目录", items: [
    { label: "租户管理", path: "/super-admin/tenants", pageId: "tenants", icon: Building2 },
    { label: "服务连接器", path: "/super-admin/connectors", pageId: "connector-catalog", icon: Plug },
    { label: "数据字典", path: "/super-admin/dicts", pageId: "dictionary", icon: BookOpen },
  ] },
  { label: "运行与调度", items: [
    { label: "运行环境", path: "/super-admin/runtime-images", pageId: "runtime-catalog", icon: Cpu },
    { label: "Profiles", path: "/super-admin/profiles", pageId: "profiles", icon: SlidersHorizontal },
    { label: "网关控制", path: "/super-admin/gateway-control", pageId: "gateway", icon: Network },
    { label: "定时任务", path: "/super-admin/scheduled-tasks", pageId: "schedules", icon: CalendarClock },
  ] },
  { label: "观测", items: [{ label: "监控大盘", path: "/super-admin/observability", pageId: "platform-observability", icon: BarChart3, gated: "observability" }] },
  { label: "平台治理", items: [{ label: "审计日志", path: "/super-admin/audit-logs", pageId: "platform-audit", icon: ScrollText }] },
];

export const tenantNavigation: AdminNavigationGroup[] = [
  { label: "总览", items: [{ label: "租户总览", path: "/tenant/overview", pageId: "tenant-overview", icon: LayoutDashboard }] },
  { label: "智能体与依赖", items: [
    { label: "智能体", path: "/tenant/agents", pageId: "agents", icon: Bot },
    { label: "技能", path: "/tenant/skills", pageId: "skills", icon: Boxes },
    { label: "模型", path: "/tenant/models", pageId: "models", icon: Cpu },
    { label: "知识库", path: "/tenant/knowledge", pageId: "knowledge", icon: BookOpen },
    { label: "连接器目录", path: "/tenant/connectors", pageId: "connectors", icon: Plug },
  ] },
  { label: "运行与渠道", items: [
    { label: "应用渠道", path: "/tenant/channels", pageId: "channels", icon: Webhook },
    { label: "运行时", path: "/tenant/runtimes-v2", pageId: "runtime-instances", icon: Cpu },
    { label: "控制中心", path: "/tenant/control-center", pageId: "control-center", icon: Workflow },
  ] },
  { label: "观测", items: [
    { label: "链路追踪", path: "/tenant/traces", pageId: "traces", icon: Activity },
    { label: "评测", path: "/tenant/evaluations", pageId: "evaluations", icon: ClipboardList },
  ] },
  { label: "运营", items: [
    { label: "内容管理", path: "/tenant/content", pageId: "content", icon: FileText },
    { label: "业务统计", path: "/tenant/data-platform", pageId: "business-analytics", icon: Database },
    { label: "功能统计", path: "/tenant/feature-usage", pageId: "feature-usage", icon: BarChart3 },
  ] },
  { label: "平台设置", items: [
    { label: "授权管理", path: "/tenant/authorization-catalog", pageId: "authorization", icon: KeyRound },
    { label: "开通管理", path: "/tenant/provisioning", pageId: "provisioning", icon: ClipboardList },
    { label: "平台用户", path: "/tenant/platform-users", pageId: "tenant-users", icon: Users },
    { label: "审计日志", path: "/tenant/audit-logs", pageId: "tenant-audit", icon: ScrollText },
  ] },
];

export const platformRoutes: AdminRoute[] = [
  ...platformNavigation.flatMap((group) => group.items.map(({ path, pageId }) => ({ path, pageId, shell: "platform" as const }))),
  { path: "/super-admin/connectors/import", pageId: "connector-import", shell: "platform" },
  { path: "/super-admin/runtime-images/kind/:kind", pageId: "runtime-category", shell: "platform" },
  { path: "/super-admin/profiles/config/:kind", pageId: "profile-kind", shell: "platform" },
  { path: "/super-admin/scheduled-tasks/tasks/:taskId", pageId: "schedule-task", shell: "platform" },
  { path: "/super-admin/scheduled-tasks/runs/:runId", pageId: "schedule-run", shell: "platform" },
  { path: "/super-admin/scheduled-tasks/executions/:ownerKind/:date", pageId: "schedule-batch", shell: "platform" },
  { path: "/super-admin/runtime-gateway", redirect: "/super-admin/gateway-control", shell: "platform" },
];

export const tenantRoutes: AdminRoute[] = [
  { path: "/tenant/agents/:agentId", pageId: "agent-detail", shell: "tenant" },
  ...tenantNavigation.flatMap((group) => group.items.map(({ path, pageId }) => ({ path, pageId, shell: "tenant" as const }))),
  { path: "/tenant/runtimes", redirect: "/tenant/runtimes-v2", shell: "tenant" },
  { path: "/tenant/runtimes-v2/environments/kind/:kind", pageId: "runtime-environment-category", shell: "tenant" },
  { path: "/tenant/runtimes-v2/scenarios/kind/:kind", pageId: "runtime-scenario-category", shell: "tenant" },
  { path: "/tenant/runtimes-v2/environments/:envId", pageId: "runtime-environment", shell: "tenant" },
  { path: "/tenant/runtimes/:id/console", pageId: "runtime-console", shell: "tenant" },
  { path: "/tenant/control-center/template-rollouts", redirect: "/tenant/control-center", shell: "tenant" },
  { path: "/tenant/control-center/template-rollouts/:rolloutId", pageId: "rollout-detail", shell: "tenant" },
  { path: "/tenant/control-center/delivery-history", redirect: "/tenant/control-center", shell: "tenant" },
  { path: "/tenant/traces/:traceId", pageId: "trace-detail", shell: "tenant" },
  { path: "/tenant/data-platform/traces/:traceId", pageId: "trace-detail", shell: "tenant" },
  { path: "/tenant/data-platform/skills", pageId: "skill-analytics", shell: "tenant" },
  { path: "/tenant/data-platform/agents", pageId: "agent-analytics", shell: "tenant" },
  { path: "/tenant/analytics", pageId: "content-analytics", shell: "tenant" },
  { path: "/tenant/templates", redirect: "/tenant/card-templates", shell: "tenant" },
  { path: "/tenant/card-templates", pageId: "card-templates", shell: "tenant" },
  { path: "/tenant/content/templates", redirect: "/tenant/card-templates", shell: "tenant" },
  { path: "/tenant/content/new", pageId: "content-editor", shell: "tenant" },
  { path: "/tenant/content/:slug/detail", pageId: "content-detail", shell: "tenant" },
  { path: "/tenant/content/:slug", pageId: "content-editor", shell: "tenant" },
  { path: "/tenant/distribution/channels", pageId: "distribution-channels", shell: "tenant" },
  { path: "/tenant/knowledge/create", pageId: "knowledge-create", shell: "tenant" },
  { path: "/tenant/knowledge/:spaceId/documents/:documentId", pageId: "knowledge-document", shell: "tenant" },
  { path: "/tenant/knowledge/:spaceId", pageId: "knowledge-detail", shell: "tenant" },
  { path: "/tenant/wps-app-pool", redirect: "/tenant/provisioning?tab=pool", shell: "tenant" },
  { path: "/tenant/wps-app-pool/apps/:resourceId", pageId: "wps-app-detail", shell: "tenant" },
  { path: "/tenant/users", redirect: "/tenant/platform-users", shell: "tenant" },
];
