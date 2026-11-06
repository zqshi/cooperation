import type { AdminPageId } from "./navigation.js";

export type AdminField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "secret" | "json" | "date";
  required?: boolean;
  createOnly?: boolean;
  options?: readonly { label: string; value: string }[];
  placeholder?: string;
};

export type AdminColumn = { key: string; label: string };
export type AdminCommand = {
  id: string;
  label: string;
  method: "POST" | "PUT" | "DELETE";
  endpoint: string;
  confirm?: string;
  body?: Record<string, unknown>;
};

export type AdminPageDefinition = {
  title: string;
  description: string;
  endpoint: string;
  kind: "resource" | "workflow" | "dashboard" | "detail";
  fields: readonly AdminField[];
  columns: readonly AdminColumn[];
  actions: readonly AdminCommand[];
  responseKey?: string;
  idParam?: string;
  parent?: AdminPageId;
};

const field = (
  name: string,
  label: string,
  type: AdminField["type"] = "text",
  required = false,
  options?: AdminField["options"],
): AdminField => ({ name, label, type, required, ...(options ? { options } : {}) });
const command = (
  id: string,
  label: string,
  endpoint: string,
  confirm?: string,
  method: AdminCommand["method"] = "POST",
  body?: Record<string, unknown>,
): AdminCommand => ({ id, label, endpoint, method, ...(confirm ? { confirm } : {}), ...(body ? { body } : {}) });
const resource = (
  title: string,
  description: string,
  endpoint: string,
  fields: readonly AdminField[],
  columns: readonly string[],
  actions: readonly AdminCommand[] = [],
  kind: AdminPageDefinition["kind"] = "resource",
  parent?: AdminPageId,
): AdminPageDefinition => ({
  title,
  description,
  endpoint,
  fields,
  columns: columns.map((key) => ({ key, label: key })),
  actions,
  kind,
  ...(parent ? { parent } : {}),
});

export const adminPageCatalog: Record<AdminPageId, AdminPageDefinition> = {
  "platform-overview": resource("平台总览", "平台租户、资源和运行情况。", "/v1/admin/platform/overview", [], ["tenantCount", "activeTenantCount", "runCount"], [], "dashboard"),
  tenants: resource("租户管理", "创建租户、维护企业配置并管理生命周期。", "/v1/admin/platform/tenants", [field("name", "租户名称", "text", true), { ...field("slug", "租户标识", "text", true), createOnly: true }, field("plan", "套餐", "select", true, [{ label: "试用", value: "trial" }, { label: "团队", value: "team" }, { label: "企业", value: "enterprise" }]), field("industry", "行业"), field("companySize", "企业规模"), field("contactPhone", "联系电话"), field("description", "说明", "textarea"), { ...field("ownerName", "负责人姓名", "text", true), createOnly: true }, { ...field("ownerEmail", "负责人邮箱", "text", true), createOnly: true }, { ...field("ownerPassword", "初始密码", "secret", true), createOnly: true }], ["name", "slug", "plan", "status", "createdAt"]),
  "connector-catalog": resource("服务连接器", "导入、发布并授权可供租户使用的服务连接器。", "/v1/admin/platform/connectors", [field("displayName", "显示名称", "text", true), field("sourceType", "来源", "select", true, [{ label: "Endpoint", value: "endpoint" }, { label: "OpenAPI", value: "openapi" }, { label: "MCP", value: "mcp" }]), field("sourceUrl", "定义地址", "text", true), field("ownerTeam", "维护团队", "text", true), field("description", "说明", "textarea")], ["displayName", "sourceType", "revision", "status", "projectionStatus"], [command("preview", "导入预览", "/v1/admin/platform/connectors:import-preview"), command("health-check", "健康检查", "/v1/admin/platform/connectors/:id:health-check"), command("publish", "发布", "/v1/admin/platform/connectors/:id:publish", "发布此连接器修订并使其对已授权租户可用。"), command("disable", "停用", "/v1/admin/platform/connectors/:id:disable", "停用会阻止新的租户调用。")], "workflow"),
  "connector-import": resource("导入服务连接器", "先解析定义并检查能力，再确认导入。", "/v1/admin/platform/connectors:import-preview", [field("sourceType", "来源类型", "select", true, [{ label: "Endpoint", value: "endpoint" }, { label: "OpenAPI", value: "openapi" }, { label: "MCP", value: "mcp" }]), field("sourceUrl", "来源地址", "text", true), field("displayName", "显示名称", "text", true), field("ownerTeam", "维护团队", "text", true), field("includeTools", "包含工具名称", "textarea")], ["name", "description", "method", "path"], [command("preview", "解析预览", "/v1/admin/platform/connectors:import-preview"), command("import", "确认导入", "/v1/admin/platform/connectors:import", "创建连接器目录项与不可变修订。")], "workflow", "connector-catalog"),
  dictionary: resource("数据字典", "维护平台分类、编码、名称和显示顺序。", "/v1/admin/platform/dictionaries", [field("category", "分类", "text", true), field("code", "编码", "text", true), field("label", "显示名称", "text", true), field("description", "说明", "textarea"), field("sortOrder", "排序", "number", true), field("enabled", "启用", "boolean")], ["category", "code", "label", "sortOrder", "enabled"]),
  "runtime-catalog": resource("运行环境", "登记平台允许租户使用的运行镜像。", "/v1/admin/platform/runtime-images", [field("name", "产品名称", "text", true), field("kind", "运行时类型", "select", true, [{ label: "Agent", value: "agent" }, { label: "工具", value: "tool" }, { label: "浏览器", value: "browser" }]), field("imageRef", "镜像引用", "text", true), field("description", "说明", "textarea"), field("enabled", "启用", "boolean")], ["name", "kind", "imageRef", "enabled", "updatedAt"]),
  "runtime-category": resource("运行环境版本", "查看此运行时分类下的镜像产品和版本。", "/v1/admin/platform/runtime-images?kind=:kind", [field("name", "产品名称", "text", true), field("imageRef", "镜像引用", "text", true), field("version", "版本", "text", true)], ["name", "version", "digest", "status"], [], "resource", "runtime-catalog"),
  profiles: resource("Profiles", "配置运行规格、网络边界和运行限制。", "/v1/admin/platform/profiles", [field("name", "名称", "text", true), field("kind", "类型", "select", true, [{ label: "资源规格", value: "spec" }, { label: "网络", value: "network" }, { label: "配置", value: "config" }, { label: "开关", value: "toggle" }]), field("cpuMillis", "CPU 毫核", "number", true), field("memoryMb", "内存 MB", "number", true), field("timeoutSeconds", "超时秒数", "number", true), field("allowedHosts", "允许访问的主机", "json", true), field("environment", "环境变量", "json", true), field("enabled", "启用", "boolean")], ["name", "kind", "cpuMillis", "memoryMb", "timeoutSeconds", "version", "enabled"]),
  "profile-kind": resource("Profile 配置", "按运行时类别管理对应配置档案。", "/v1/admin/platform/profiles?kind=:kind", [field("name", "名称", "text", true), field("definition", "配置", "json", true)], ["name", "version", "status"], [], "resource", "profiles"),
  gateway: resource("出口主机白名单", "登记工具和模型可访问的精确公共主机名。", "/v1/platform/gateway-control/upstreams", [field("hostname", "主机名", "text", true), field("purpose", "用途", "select", true, [{ label: "工具", value: "tool" }, { label: "模型", value: "model" }, { label: "工具与模型", value: "both" }]), field("reason", "放行原因", "textarea", true), field("enabled", "启用", "boolean")], ["hostname", "purpose", "reason", "enabled", "updatedAt"], [command("delete", "移除", "/v1/platform/gateway-control/upstreams/:id", "移除此主机后，新的出站请求将无法使用它。", "DELETE")], "workflow"),
  schedules: resource("定时任务", "管理平台维护任务、手动触发与执行历史。", "/v1/platform/scheduled-tasks", [field("name", "名称", "text", true), field("handler", "处理器", "select", true, [{ label: "过期审批清理", value: "approval-expiry" }, { label: "租约恢复", value: "lease-recovery" }, { label: "数据清理", value: "cleanup" }]), field("intervalMinutes", "执行间隔（分钟）", "number", true), field("enabled", "启用", "boolean")], ["name", "handler", "intervalMinutes", "enabled", "nextAt"], [command("trigger", "立即运行", "/v1/platform/scheduled-tasks/:id:trigger")], "workflow"),
  "schedule-task": resource("定时任务详情", "查看任务配置和最近执行记录。", "/v1/platform/scheduled-tasks/:taskId", [], ["task", "runs"], [], "detail", "schedules"),
  "schedule-run": resource("任务运行详情", "查看一次维护任务的状态、结果和错误。", "/v1/platform/scheduled-runs/:runId", [], ["id", "scheduleId", "status", "trigger", "result", "error", "createdAt", "startedAt", "finishedAt"], [], "detail", "schedules"),
  "schedule-batch": resource("批次运行详情", "查看指定日期内的平台任务执行记录。", "/v1/platform/scheduled-runs/date/:date", [], ["id", "scheduleId", "status", "trigger", "result", "error", "createdAt", "startedAt", "finishedAt"], [], "dashboard", "schedules"),
  "platform-observability": resource("监控大盘", "按时间范围检查平台运行量、失败和租户状态。", "/v1/admin/platform/observability", [], ["hour", "runs", "failed", "active"], [], "dashboard"),
  "platform-audit": resource("平台审计日志", "搜索平台身份发起的变更与操作记录。", "/v1/admin/platform/audit-log", [], ["occurredAt", "actor", "action", "resource", "outcome"], [], "dashboard"),
  "tenant-overview": resource("租户总览", "查看当前租户资源、运行和服务健康概况。", "/v1/admin/tenant/overview", [], ["agents", "users", "runs", "usage"], [], "dashboard"),
  agents: resource("智能体", "创建和管理智能体定义、版本与发布状态。", "/v1/admin/tenant/agents", [field("name", "名称", "text", true), field("description", "说明", "textarea"), field("instructions", "系统指令", "textarea", true), field("modelId", "默认模型", "text", true), field("toolPlan", "工具计划", "json")], ["name", "version", "status", "updatedAt"], [command("publish", "发布", "/v1/admin/tenant/agents/:id:publish"), command("archive", "归档", "/v1/admin/tenant/agents/:id:archive")]),
  "agent-detail": resource("智能体详情", "查看定义、发布版本、运行记录和修订历史。", "/v1/admin/tenant/agents/:agentId", [], ["version", "status", "createdAt", "changelog"], [], "detail", "agents"),
  skills: resource("技能", "维护技能说明、版本、来源和安装状态。", "/v1/admin/tenant/skills", [field("name", "名称", "text", true), field("description", "说明", "textarea"), field("instructions", "技能指令", "textarea", true), field("version", "版本", "text", true)], ["name", "version", "source", "status"], [command("enable", "启用", "/v1/admin/tenant/skills/:id:enable"), command("disable", "停用", "/v1/admin/tenant/skills/:id:disable")]),
  models: resource("模型", "配置供应商连接、模型能力、密钥与可用状态。", "/v1/admin/tenant/models", [field("name", "连接名称", "text", true), field("provider", "供应商", "text", true), field("baseUrl", "API 地址", "text", true), field("modelName", "模型名称", "text", true), field("apiKey", "API 密钥", "secret"), field("capabilities", "能力", "json")], ["name", "provider", "modelName", "status", "checkedAt"], [command("check", "检查连接", "/v1/admin/tenant/models/:id:health-check"), command("disable", "停用", "/v1/admin/tenant/models/:id:disable")]),
  knowledge: resource("知识库", "创建知识空间，管理文档摄取和检索配置。", "/v1/admin/tenant/knowledge-spaces", [field("name", "知识库名称", "text", true), field("description", "说明", "textarea"), field("embeddingModel", "向量模型", "text", true)], ["name", "documentCount", "status", "updatedAt"]),
  "knowledge-create": resource("创建知识库", "配置知识空间并选择索引模型。", "/v1/admin/tenant/knowledge-spaces", [field("name", "知识库名称", "text", true), field("description", "说明", "textarea"), field("embeddingModel", "向量模型", "text", true)], ["name", "status"], [], "resource", "knowledge"),
  "knowledge-detail": resource("知识库详情", "查看知识库设置、文档和索引状态。", "/v1/admin/tenant/knowledge-spaces/:spaceId", [], ["name", "documentCount", "status", "updatedAt"], [command("reindex", "重建索引", "/v1/admin/tenant/knowledge-spaces/:spaceId:reindex")], "detail", "knowledge"),
  "knowledge-document": resource("知识文档", "查看文档摄取状态、分块及处理错误。", "/v1/admin/tenant/knowledge-spaces/:spaceId/documents/:documentId", [], ["name", "mimeType", "status", "chunkCount", "error"], [command("retry", "重新处理", "/v1/admin/tenant/documents/:documentId:retry")], "detail", "knowledge"),
  connectors: resource("连接器目录", "查看获授权的连接器能力并绑定至智能体。", "/v1/admin/tenant/connectors", [field("providerId", "连接器", "text", true), field("configuration", "绑定配置", "json")], ["displayName", "revision", "entitlement", "health"], [command("validate", "验证绑定", "/v1/admin/tenant/connectors/:id:validate")]),
  channels: resource("应用渠道", "管理渠道账号、路由绑定、群组和健康状态。", "/v1/admin/tenant/channels", [field("provider", "渠道类型", "text", true), field("name", "账号名称", "text", true), field("configuration", "账号配置", "json", true)], ["name", "provider", "status", "health", "bindingCount"], [command("health-check", "健康检查", "/v1/admin/tenant/channels/:id:health-check"), command("unbind", "解除绑定", "/v1/admin/tenant/channels/:id:unbind", "解除该渠道路由绑定。", "DELETE")], "workflow"),
  "runtime-instances": resource("运行时", "创建、连接、检查和维护租户运行时实例。", "/v1/admin/tenant/runtime-instances", [field("name", "实例名称", "text", true), field("imageVersionId", "运行镜像版本", "text", true), field("profileId", "Profile", "text", true), field("environment", "环境变量", "json")], ["name", "runtimeKind", "status", "createdAt"], [command("create", "创建实例", "/v1/admin/tenant/runtime-instances"), command("stop", "停止", "/v1/admin/tenant/runtime-instances/:id:stop", "停止实例会中断当前会话。"), command("rebuild", "重建", "/v1/admin/tenant/runtime-instances/:id:rebuild", "重建会替换当前实例环境。")], "workflow"),
  "runtime-console": resource("运行时控制台", "查看实例状态、终端连接与运行事件。", "/v1/admin/tenant/runtime-instances/:id", [], ["name", "status", "providerState", "lastHeartbeat"], [command("connect", "连接", "/v1/admin/tenant/runtime-instances/:id:connect")], "detail", "runtime-instances"),
  "runtime-environment-category": resource("环境目录", "按运行时类型查看环境版本。", "/v1/admin/tenant/runtime-environments?kind=:kind", [field("name", "环境名称", "text", true), field("version", "版本", "text", true), field("definition", "环境配置", "json", true)], ["name", "version", "status"], [], "resource", "runtime-instances"),
  "runtime-scenario-category": resource("场景目录", "按运行时类型查看场景模板。", "/v1/admin/tenant/runtime-scenarios?kind=:kind", [field("name", "场景名称", "text", true), field("version", "版本", "text", true), field("definition", "场景配置", "json", true)], ["name", "version", "status"], [], "resource", "runtime-instances"),
  "runtime-environment": resource("运行环境详情", "查看环境版本、配置和物化历史。", "/v1/admin/tenant/runtime-environments/:envId", [], ["name", "version", "image", "status", "materializedAt"], [command("materialize", "物化版本", "/v1/admin/tenant/runtime-environments/:envId:materialize")], "detail", "runtime-instances"),
  "control-center": resource("控制中心", "创建 rollout、选择目标并追踪交付结果。", "/v1/admin/tenant/rollouts", [field("name", "批次名称", "text", true), field("templateId", "模板版本", "text", true), field("targets", "目标范围", "json", true), field("strategy", "投放策略", "select", true, [{ label: "立即", value: "immediate" }, { label: "分批", value: "batch" }])], ["name", "targetCount", "deliveredCount", "failedCount", "status"], [command("start", "开始投放", "/v1/admin/tenant/rollouts/:id:start", "开始向所选目标投放此模板版本。"), command("retry-failed", "重试失败项", "/v1/admin/tenant/rollouts/:id:retry-failed")], "workflow"),
  "rollout-detail": resource("投放详情", "检查批次状态、目标结果和失败重试记录。", "/v1/admin/tenant/rollouts/:rolloutId", [], ["target", "status", "attempt", "error", "updatedAt"], [command("retry", "重试此项", "/v1/admin/tenant/rollouts/:rolloutId/items/:itemId:retry")], "detail", "control-center"),
  traces: resource("链路追踪", "按时间、状态和运行类型检索执行链路。", "/v1/admin/tenant/traces", [], ["traceId", "operation", "actor", "status", "duration", "startedAt"], [], "dashboard"),
  "trace-detail": resource("Trace 详情", "查看跨度、模型调用、工具调用和错误详情。", "/v1/admin/tenant/traces/:traceId", [], ["span", "component", "status", "duration", "attributes"], [], "detail", "traces"),
  evaluations: resource("评测", "管理数据集、评估器、实验和逐例结果。", "/v1/admin/tenant/evaluations", [field("name", "名称", "text", true), field("kind", "资源类型", "select", true, [{ label: "数据集", value: "dataset" }, { label: "评估器", value: "evaluator" }, { label: "实验", value: "experiment" }]), field("definition", "定义", "json", true)], ["name", "kind", "version", "status"], [command("run", "运行评测", "/v1/admin/tenant/evaluations/:id:runs")], "workflow"),
  content: resource("内容管理", "编辑版本、媒体和内容发布状态。", "/v1/admin/tenant/content", [field("title", "标题", "text", true), field("slug", "路径", "text", true), field("summary", "摘要", "textarea"), field("body", "正文", "textarea", true), field("media", "媒体引用", "json"), field("status", "状态", "select", true, [{ label: "草稿", value: "draft" }, { label: "审核中", value: "review" }, { label: "已发布", value: "published" }])], ["title", "slug", "version", "status", "updatedAt"], [command("publish", "发布", "/v1/admin/tenant/content/:id:publish", "发布当前内容版本。"), command("archive", "归档", "/v1/admin/tenant/content/:id:archive")], "workflow"),
  "content-editor": resource("内容编辑器", "编辑内容并创建新版本。", "/v1/admin/tenant/content/:slug", [field("title", "标题", "text", true), field("slug", "路径", "text", true), field("summary", "摘要", "textarea"), field("body", "正文", "textarea", true)], ["title", "version", "status"], [], "resource", "content"),
  "content-detail": resource("内容详情", "查看发布版本、评论、分发和互动记录。", "/v1/admin/tenant/content/:slug", [], ["version", "status", "publishedAt", "revision"], [command("publish", "发布版本", "/v1/admin/tenant/content/:slug:publish")], "detail", "content"),
  "content-analytics": resource("内容分析", "查看投递漏斗、触达和互动表现。", "/v1/admin/tenant/content/analytics", [], ["content", "sent", "opened", "clicked", "period"], [], "dashboard", "content"),
  "card-templates": resource("卡片模板", "编辑和预览卡片模板及修订。", "/v1/admin/tenant/card-templates", [field("name", "模板名称", "text", true), field("schema", "卡片定义", "json", true), field("previewData", "预览数据", "json")], ["name", "version", "status", "updatedAt"], [command("publish", "发布模板", "/v1/admin/tenant/card-templates/:id:publish")]),
  "distribution-channels": resource("分发渠道", "配置机器人、群组和渠道投递策略。", "/v1/admin/tenant/distribution/channels", [field("name", "名称", "text", true), field("channelAccountId", "渠道账号", "text", true), field("target", "目标群组", "json"), field("enabled", "启用", "boolean")], ["name", "account", "targetCount", "status"], [command("bind", "绑定机器人", "/v1/admin/tenant/distribution/channels/:id:bind"), command("unbind", "解除绑定", "/v1/admin/tenant/distribution/channels/:id:unbind", "解除此渠道绑定。", "DELETE")]),
  "business-analytics": resource("业务统计", "查看租户业务使用、Agent 和渠道统计。", "/v1/admin/tenant/analytics/business", [], ["metric", "value", "change", "period"], [], "dashboard"),
  "skill-analytics": resource("技能统计", "按技能和版本检查使用与失败情况。", "/v1/admin/tenant/analytics/skills", [], ["skill", "version", "runs", "failures"], [], "dashboard"),
  "agent-analytics": resource("Agent 消耗", "检查 Agent 调用、时延、成本和错误。", "/v1/admin/tenant/analytics/agents", [], ["agent", "runs", "tokens", "cost", "errors"], [], "dashboard"),
  "feature-usage": resource("功能统计", "查看各功能使用趋势和资源消耗。", "/v1/admin/tenant/analytics/features", [], ["feature", "users", "events", "period"], [], "dashboard"),
  authorization: resource("授权目录", "浏览角色权限、资源授权与当前授权范围。", "/v1/admin/tenant/authorization-catalog", [], ["role", "capability", "scope", "description"], [], "dashboard"),
  provisioning: resource("开通管理", "管理开通请求、应用资源池、批次和重试。", "/v1/admin/tenant/provisioning", [field("kind", "开通类型", "select", true, [{ label: "WPS 应用", value: "wps-app" }]), field("name", "批次名称", "text", true), field("targets", "开通目标", "json", true)], ["batch", "kind", "total", "succeeded", "failed", "status"], [command("retry-failed", "重试失败项", "/v1/admin/tenant/provisioning/:id:retry-failed"), command("cancel", "取消批次", "/v1/admin/tenant/provisioning/:id:cancel", "取消尚未完成的开通工作。")], "workflow"),
  "wps-app-detail": resource("WPS 应用详情", "检查应用池资源、绑定用户和开通记录。", "/v1/admin/tenant/provisioning/wps-apps/:resourceId", [], ["resourceId", "status", "assignedTo", "updatedAt"], [command("release", "释放资源", "/v1/admin/tenant/provisioning/wps-apps/:resourceId:release")], "detail", "provisioning"),
  "tenant-users": resource("平台用户", "管理租户用户、角色、分组和访问状态。", "/v1/admin/tenant/users", [field("email", "邮箱", "text", true), field("displayName", "姓名", "text", true), field("role", "角色", "select", true, [{ label: "管理员", value: "admin" }, { label: "构建者", value: "builder" }, { label: "运营者", value: "operator" }, { label: "审计员", value: "auditor" }, { label: "成员", value: "member" }]), field("groups", "用户组", "json")], ["displayName", "email", "role", "status", "lastSeenAt"], [command("disable", "禁用", "/v1/admin/tenant/users/:id:disable", "禁用将撤销此用户当前会话。"), command("enable", "启用", "/v1/admin/tenant/users/:id:enable")]),
  "tenant-audit": resource("审计日志", "检索租户范围内的管理和业务操作。", "/v1/admin/tenant/audit-log", [], ["occurredAt", "actor", "action", "resource", "outcome"], [], "dashboard"),
};
