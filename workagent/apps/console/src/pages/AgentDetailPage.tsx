import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { AgentDefinition } from "@workagent/contracts";
import {
  Badge,
  CopyButton,
  Button,
  Card,
  DataTable,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  Textarea,
  formatCost,
  formatDate,
  get,
  post,
  put,
} from "@workagent/ui";
import type {
  AgentDetail,
  Connector,
  KnowledgeSpace,
  Skill,
} from "../lib/types.js";

type PreviewResult = {
  output: string;
  toolCalls: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
  systemPrompt: string;
  tools: string[];
};

export function AgentDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("config");
  const [definition, setDefinition] = useState<AgentDefinition | null>(null);
  const [changelog, setChangelog] = useState("");
  const [previewMessage, setPreviewMessage] = useState(
    "请根据以下会议记录整理决定、待办和未解决问题：周三讨论新产品发布，李明负责整理素材，下周一复核。",
  );
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(
    null,
  );

  const detail = useQuery({
    queryKey: ["agent", id],
    queryFn: () => get<AgentDetail>(`/v1/agents/${id}`),
    enabled: Boolean(id),
  });
  const skills = useQuery({
    queryKey: ["skills"],
    queryFn: () => get<{ items: Skill[] }>("/v1/skills"),
  });
  const connectors = useQuery({
    queryKey: ["connectors"],
    queryFn: () => get<{ items: Connector[] }>("/v1/connectors"),
  });
  const spaces = useQuery({
    queryKey: ["knowledge-spaces"],
    queryFn: () => get<{ items: KnowledgeSpace[] }>("/v1/knowledge-spaces"),
  });

  const loadedDefinition =
    detail.data?.draft?.definition ??
    detail.data?.published?.definition ??
    null;
  useEffect(() => {
    if (loadedDefinition) setDefinition(loadedDefinition);
  }, [detail.data?.draft?.id, detail.data?.published?.id]);

  const dirty = Boolean(
    definition &&
    loadedDefinition &&
    JSON.stringify(definition) !== JSON.stringify(loadedDefinition),
  );
  useEffect(() => {
    if (!dirty) return;
    setPreviewResult(null);
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a[href]");
      if (anchor && !window.confirm("草稿有未保存修改，放弃修改并离开？")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  const readiness = useQuery({
    queryKey: ["tenant-home"],
    queryFn: () =>
      get<import("@workagent/contracts").TenantHome>("/v1/tenant-home"),
  });
  const save = useMutation({
    mutationFn: () =>
      put<AgentDetail>(`/v1/agents/${id}`, { definition, changelog }),
    onSuccess: (data) => {
      setChangelog("");
      queryClient.setQueryData(["agent", id], data);
      const next = data.draft?.definition ?? data.published?.definition ?? null;
      if (next) setDefinition(next);
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      post<AgentDetail>(`/v1/agents/${id}/publish`, { changelog }),
    onSuccess: (data) => {
      setChangelog("");
      queryClient.setQueryData(["agent", id], data);
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const preview = useMutation({
    mutationFn: () =>
      post<PreviewResult>(`/v1/agents/${id}/preview`, {
        message: previewMessage,
      }),
    onSuccess: (data) => setPreviewResult(data),
  });

  if (detail.error) return <ErrorText error={detail.error} />;
  if (detail.isLoading) return <Spinner />;
  if (!definition || !detail.data)
    return (
      <Card title="没有可编辑的版本">
        <p>请返回 Agent 列表重新选择。</p>
        <Link to="/tenant/agents">返回列表 →</Link>
      </Card>
    );

  const agent = detail.data!.agent;
  const draft = detail.data!.draft;

  const update = <K extends keyof AgentDefinition>(
    key: K,
    value: AgentDefinition[K],
  ) => {
    setDefinition((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleSkill = (skillId: string) => {
    const set = new Set(definition.tools.skillIds);
    if (set.has(skillId)) set.delete(skillId);
    else set.add(skillId);
    update("tools", { ...definition.tools, skillIds: Array.from(set) });
  };

  const toggleConnector = (connectorId: string) => {
    const set = new Set(definition.tools.connectorIds);
    if (set.has(connectorId)) set.delete(connectorId);
    else set.add(connectorId);
    update("tools", { ...definition.tools, connectorIds: Array.from(set) });
  };

  const toggleSpace = (spaceId: string) => {
    const exists = definition.knowledge.some((ref) => ref.spaceId === spaceId);
    update(
      "knowledge",
      exists
        ? definition.knowledge.filter((ref) => ref.spaceId !== spaceId)
        : [...definition.knowledge, { spaceId, topK: 5, minScore: 0.2 }],
    );
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to="/tenant/agents"
              className="text-slate-400 hover:text-slate-600"
            >
              Agent
            </Link>
            <span className="text-slate-300">/</span>
            {agent.name}
            <StatusBadge status={agent.status} />
          </span>
        }
        description={agent.description}
        actions={
          <>
            <Button
              variant="outline"
              loading={save.isPending}
              onClick={() => save.mutate()}
              disabled={!dirty}
            >
              保存草稿
            </Button>
            <Button
              loading={publish.isPending}
              onClick={() => publish.mutate()}
              disabled={!draft || dirty || publish.isPending}
            >
              发布新版本
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <Badge tone={dirty ? "amber" : "green"}>
          {dirty ? "有未保存修改" : "已保存"}
        </Badge>
        <span>
          草稿 {draft ? `v${draft.version}` : "未创建"} · 已发布{" "}
          {detail.data.published ? `v${detail.data.published.version}` : "无"}
        </span>
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm("放弃当前未保存修改？"))
                setDefinition(loadedDefinition);
            }}
          >
            放弃修改
          </Button>
        )}
        {detail.data.published && (
          <CopyButton
            label="复制使用链接"
            value={`${readiness.data?.portalOrigin ?? window.location.origin}/agents?agent=${id}`}
          />
        )}
      </div>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "config", label: "配置" },
          { key: "preview", label: "预览" },
          { key: "release", label: "评测与发布" },
          { key: "versions", label: "版本" },
        ]}
      />

      <ErrorText error={save.error ?? publish.error} />
      <ErrorText error={skills.error ?? connectors.error ?? spaces.error} />
      {tab === "release" && (
        <Card
          className="mt-4"
          title="发布检查"
          description="保存当前草稿，验证输出，再发布不可变版本。"
        >
          <ol className="space-y-4 text-sm">
            <li>1. {dirty ? "先保存当前修改。" : "草稿已保存。"}</li>
            <li>
              2.{" "}
              <button
                className="text-blue-700"
                onClick={() => setTab("preview")}
              >
                预览当前已保存版本 →
              </button>
            </li>
            <li>
              3.{" "}
              <Link className="text-blue-700" to="/tenant/evals">
                创建评测集、添加样例并运行评测 →
              </Link>
            </li>
            <li>
              4. 生产发布需要与当前草稿完全一致的通过评测。修改后请重新评测。
            </li>
          </ol>
          <Button
            className="mt-5"
            loading={publish.isPending}
            disabled={!draft || dirty}
            onClick={() => publish.mutate()}
          >
            发布新版本
          </Button>
          <ErrorText error={publish.error} />
        </Card>
      )}

      {tab === "config" ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="基本信息">
              <div className="space-y-4">
                <Field label="名称">
                  <Input
                    value={definition.name}
                    onChange={(event) => update("name", event.target.value)}
                  />
                </Field>
                <Field label="描述">
                  <Input
                    value={definition.description}
                    onChange={(event) =>
                      update("description", event.target.value)
                    }
                  />
                </Field>
                <Field
                  label="系统指令"
                  hint="定义角色、工作流、边界与输出格式。"
                >
                  <Textarea
                    rows={8}
                    value={definition.instructions}
                    onChange={(event) =>
                      update("instructions", event.target.value)
                    }
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="可见性">
                    <Select
                      value={definition.visibility}
                      onChange={(event) =>
                        update(
                          "visibility",
                          event.target.value as AgentDefinition["visibility"],
                        )
                      }
                    >
                      <option value="private">仅自己</option>
                      <option value="org">组织内</option>
                      <option value="public">公开</option>
                    </Select>
                  </Field>
                  <Field label="记忆">
                    <Select
                      value={
                        definition.memory.enabled
                          ? definition.memory.mode
                          : "off"
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        update("memory", {
                          enabled: value !== "off",
                          mode:
                            value === "off"
                              ? "user"
                              : (value as "session" | "user" | "org"),
                        });
                      }}
                    >
                      <option value="off">关闭</option>
                      <option value="session">会话内</option>
                      <option value="user">跨会话（用户）</option>
                      <option value="org">组织级</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </Card>

            <details>
              <summary className="mb-3 cursor-pointer text-sm font-medium text-slate-600">
                模型与执行限制
              </summary>
              <Card title="模型与限制">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="模型">
                    <Input
                      value={definition.model.model}
                      onChange={(event) =>
                        update("model", {
                          ...definition.model,
                          model: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Temperature">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={definition.model.temperature}
                      onChange={(event) =>
                        update("model", {
                          ...definition.model,
                          temperature: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="最大输出 Token">
                    <Input
                      type="number"
                      value={definition.model.maxOutputTokens}
                      onChange={(event) =>
                        update("model", {
                          ...definition.model,
                          maxOutputTokens: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="最大轮次">
                    <Input
                      type="number"
                      value={definition.limits.maxTurns}
                      onChange={(event) =>
                        update("limits", {
                          ...definition.limits,
                          maxTurns: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="最大工具调用">
                    <Input
                      type="number"
                      value={definition.limits.maxToolCalls}
                      onChange={(event) =>
                        update("limits", {
                          ...definition.limits,
                          maxToolCalls: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="单次成本上限（USD）">
                    <Input
                      type="number"
                      step="0.01"
                      value={definition.limits.maxCostUsd}
                      onChange={(event) =>
                        update("limits", {
                          ...definition.limits,
                          maxCostUsd: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
              </Card>
            </details>
            <Card title="变更说明">
              <Input
                value={changelog}
                onChange={(event) => setChangelog(event.target.value)}
                placeholder="本次修改了什么（可选）"
              />
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Skill" description="注入额外的方法论与输出规范。">
              <div className="space-y-2">
                {(skills.data?.items ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">还没有 Skill</p>
                ) : (
                  skills.data?.items.map((skill) => (
                    <label
                      key={skill.id}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={definition.tools.skillIds.includes(skill.id)}
                        onChange={() => toggleSkill(skill.id)}
                      />
                      <span>
                        <span className="block text-slate-800">
                          {skill.name}
                        </span>
                        <span className="block text-xs text-slate-400">
                          {skill.description}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </Card>

            <Card title="Connector" description="允许 Agent 调用的外部工具。">
              <div className="space-y-2">
                {(connectors.data?.items ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">还没有 Connector</p>
                ) : (
                  connectors.data?.items.map((connector) => (
                    <label
                      key={connector.id}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={definition.tools.connectorIds.includes(
                          connector.id,
                        )}
                        onChange={() => toggleConnector(connector.id)}
                      />
                      <span>
                        <span className="block text-slate-800">
                          {connector.name}
                        </span>
                        <span className="block text-xs text-slate-400">
                          {connector.tools.length} 个工具
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </Card>

            <Card title="知识库" description="运行前检索相关片段并注入上下文。">
              <div className="space-y-2">
                {(spaces.data?.items ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">还没有知识库</p>
                ) : (
                  spaces.data?.items.map((space) => (
                    <label
                      key={space.id}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={definition.knowledge.some(
                          (ref) => ref.spaceId === space.id,
                        )}
                        onChange={() => toggleSpace(space.id)}
                      />
                      <span>
                        <span className="block text-slate-800">
                          {space.name}
                        </span>
                        <span className="block text-xs text-slate-400">
                          {space.documentCount} 个文档
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </Card>

            <Card title="审批策略">
              <Field label="模式">
                <Select
                  value={definition.approval.mode}
                  onChange={(event) =>
                    update("approval", {
                      ...definition.approval,
                      mode: event.target
                        .value as AgentDefinition["approval"]["mode"],
                    })
                  }
                >
                  <option value="high_risk">仅高风险工具</option>
                  <option value="always">每次工具调用</option>
                  <option value="never">从不审批</option>
                </Select>
              </Field>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <Card
            title="试运行"
            description="使用已保存草稿进行预览；仅允许安全的工具调用。"
          >
            <Textarea
              rows={8}
              value={previewMessage}
              onChange={(event) => setPreviewMessage(event.target.value)}
            />
            <Button
              className="mt-3"
              loading={preview.isPending}
              onClick={() => preview.mutate()}
              disabled={
                !previewMessage.trim() ||
                dirty ||
                readiness.data?.readiness.modelConfigured === false
              }
            >
              运行预览
            </Button>
            {dirty && (
              <p className="mt-3 text-sm text-amber-700">
                请先保存修改，再预览。
              </p>
            )}
            {readiness.data?.readiness.modelConfigured === false && (
              <p className="mt-3 text-sm text-amber-700">
                模型服务尚未配置。请联系部署管理员设置模型密钥；你可以继续保存草稿。
              </p>
            )}
            <ErrorText error={preview.error} />
            {previewResult ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone="blue">{previewResult.turns} 轮</Badge>
                  <Badge tone="violet">
                    {previewResult.toolCalls.join(", ") || "无工具调用"}
                  </Badge>
                  <Badge tone="green">
                    {formatCost(previewResult.costUsd)}
                  </Badge>
                </div>
                <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-800">
                  {previewResult.output || "(空输出)"}
                </div>
              </div>
            ) : null}
          </Card>
          <Card
            title="编译结果"
            description="发布时会固化的系统提示词与工具清单。"
          >
            {previewResult ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">
                    工具
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {previewResult.tools.map((tool) => (
                      <Badge key={tool}>{tool}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">
                    System Prompt
                  </p>
                  <pre className="wa-scrollbar max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                    {previewResult.systemPrompt}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">运行预览后显示。</p>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "versions" ? (
        <Card className="mt-4" padding={false}>
          <DataTable
            rows={detail.data!.revisions}
            keyFor={(row) => row.id}
            columns={[
              {
                key: "version",
                header: "版本",
                render: (row) => `v${row.version}`,
              },
              {
                key: "status",
                header: "状态",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "changelog",
                header: "变更",
                render: (row) => row.changelog || "-",
              },
              {
                key: "created",
                header: "创建",
                render: (row) => formatDate(row.createdAt),
              },
              {
                key: "published",
                header: "发布",
                render: (row) => formatDate(row.publishedAt),
              },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
