import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  Badge,
  useAuth,
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
  formatCost,
  formatDate,
  formatDuration,
  get,
  post,
  relativeTime,
  safeJson,
  streamRunEvents,
} from "@workagent/ui";
import {
  Bot,
  Database,
  FileText,
  ShieldCheck,
  Settings,
  Wrench,
} from "lucide-react";
import type { AgentSummary, RunEvent } from "@workagent/contracts";
import type { RunDetail } from "../lib/types.js";
import { PersonalExecutionModal } from "../components/PersonalExecutionModal.js";

const terminal = new Set(["succeeded", "failed", "canceled", "timeout"]);

export function RunDetailPage() {
  const { user } = useAuth();
  const [acceptanceError, setAcceptanceError] = useState<unknown>();
  const [accepted, setAccepted] = useState(false);
  const { id = "", projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [streamError, setStreamError] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detail = useQuery({
    queryKey: ["run", id],
    queryFn: () => get<RunDetail>(`/v1/runs/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status && !terminal.has(status) ? 3000 : false;
    },
  });
  const agents = useQuery({
    queryKey: ["agents", "published"],
    queryFn: () =>
      get<{ items: AgentSummary[] }>("/v1/agents?status=published"),
  });

  const run = detail.data?.run;
  const contextProjectId = detail.data?.contextProjectId ?? run?.projectId;
  useEffect(() => {
    if (!run || projectId) return;
    const canonical = contextProjectId
      ? `/projects/${contextProjectId}/runs/${run.id}`
      : location.pathname;
    if (location.pathname !== canonical) navigate(canonical, { replace: true });
  }, [contextProjectId, run?.id, projectId, navigate, location.pathname]);

  const approval = detail.data?.approval;
  const isActive = run ? !terminal.has(run.status) : false;

  useEffect(() => {
    if (!run || terminal.has(run.status)) return;
    const handle = streamRunEvents(
      id,
      (raw) => {
        const event = raw as unknown as RunEvent;
        if (event.type !== "heartbeat") {
          setEvents((prev) => [...prev.slice(-199), event]);
        }
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["run", id] });
          void queryClient.invalidateQueries({ queryKey: ["runs"] });
        }, 300);
      },
      (error) => setStreamError(error),
    );
    return () => {
      handle.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [id, run?.status, queryClient]);

  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      post(`/v1/approvals/${approval?.id}/decide`, { decision, note }),
    onSuccess: () => {
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => post(`/v1/runs/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  if (detail.isLoading) return <Spinner />;
  if (run && projectId && contextProjectId !== projectId)
    return <ErrorText error="运行不属于此项目或不可访问" />;
  if (detail.error) return <ErrorText error={detail.error} />;
  if (!detail.data || !run) return <ErrorText error="任务不存在" />;

  const agent = agents.data?.items.find((item) => item.id === run.agentId);
  const streaming = events
    .filter((event) => event.type === "message.delta")
    .map((event) => (event.type === "message.delta" ? event.delta : ""))
    .join("");

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={
                detail.data.automationId
                  ? `/automations/${detail.data.automationId}`
                  : contextProjectId
                    ? `/projects?project=${contextProjectId}&tab=runs`
                    : "/projects"
              }
              className="text-slate-400 hover:text-slate-600"
            >
              {detail.data.automationId ? "返回自动化" : "返回项目执行"}
            </Link>
            <span className="text-slate-300">/</span>
            <span className="max-w-xl truncate">{run.input}</span>
            <StatusBadge status={run.status} />
          </span>
        }
        description={`${agent?.name ?? "Agent"} · ${formatDate(run.createdAt)} · ${run.turns} 轮 · ${formatCost(run.costUsd)}`}
        actions={
          <>
            {run.status === "succeeded" && !run.projectId ? (
              <Button variant="outline" onClick={() => setFollowUp(true)}>
                继续对话
              </Button>
            ) : null}
            {isActive && detail.data.capabilities?.canWrite ? (
              <Button
                variant="danger"
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                取消执行
              </Button>
            ) : null}
          </>
        }
      />

      {run.projectId && (
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm">
          <p>项目执行记录 · 不替代任务验收</p>
          {detail.data.task ? (
            <Link
              className="mt-2 inline-block text-blue-700"
              to={`/projects?project=${run.projectId}&task=${detail.data.task.id}`}
            >
              返回任务 · {detail.data.task.title}
            </Link>
          ) : (
            <p className="mt-2 text-slate-500">
              原任务已移除，执行来源和历史仍保留。
            </p>
          )}
        </div>
      )}
      <ErrorText error={streamError ?? cancel.error ?? acceptanceError} />
      {run.status === "queued" && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          执行已进入队列，等待开始执行。若长时间没有进展，请联系企业管理员检查执行队列；你也可以取消本次执行。
        </p>
      )}
      {run.status === "failed" && (
        <p className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          本次执行未完成。请查看错误原因，确认模型与所需工具配置后再发起任务。
        </p>
      )}
      {detail.data.acceptance && (
        <Card className="mb-5" title="独立验收">
          <Badge
            tone={
              detail.data.acceptance.decision === "accepted" ? "green" : "red"
            }
          >
            {detail.data.acceptance.decision === "accepted"
              ? "验收通过"
              : "验收未通过"}
          </Badge>
          <p className="mt-2 text-sm text-slate-600">
            {detail.data.acceptance.note}
          </p>
        </Card>
      )}
      {run.status === "succeeded" && detail.data.capabilities?.canAccept && (
        <Card>
          <p>独立验收</p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="验收意见"
          />
          <Button
            disabled={accepted}
            onClick={() =>
              void post(`/v1/runs/${id}/acceptance`, {
                decision: "accepted",
                note,
              })
                .then(() => {
                  setAccepted(true);
                  void queryClient.invalidateQueries({ queryKey: ["run", id] });
                })
                .catch(setAcceptanceError)
            }
          >
            {accepted ? "已验收" : "验收通过"}
          </Button>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="对话">
            <div className="space-y-4">
              {detail.data.messages
                .filter(
                  (message) =>
                    message.role === "user" || message.role === "assistant",
                )
                .map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-[85%] rounded-xl bg-blue-600 px-4 py-3 text-sm text-white"
                        : "max-w-[90%] rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800"
                    }
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                ))}
              {streaming ? (
                <div className="max-w-[90%] rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800">
                  <p className="whitespace-pre-wrap">{streaming}</p>
                </div>
              ) : null}
              {detail.data.messages.length <= 1 &&
              run.status !== "succeeded" ? (
                <p className="text-xs text-slate-400">
                  {run.status === "waiting_approval"
                    ? "执行已暂停，等待人工审批；可在审批区查看操作详情。"
                    : isActive
                      ? "Agent 正在执行，结果会自动更新。"
                      : "此任务已结束，暂无对话内容。"}
                </p>
              ) : null}
            </div>
          </Card>

          {detail.data.artifacts.length > 0 ? (
            <Card title="产物">
              <ul className="space-y-2">
                {detail.data.artifacts.map((artifact) => (
                  <li
                    key={artifact.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-slate-400" />
                      <span className="text-sm text-slate-800">
                        {artifact.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        {(artifact.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <a
                      href={artifact.url}
                      className="text-xs text-blue-600 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      下载
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="执行时间线" padding={false}>
            {(detail.data.steps.length === 0 ? [] : detail.data.steps)
              .length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-slate-400">
                暂无步骤记录
              </p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {detail.data.steps.map((step) => {
                  const Icon =
                    step.kind === "tool"
                      ? Wrench
                      : step.kind === "knowledge"
                        ? Database
                        : step.kind === "approval"
                          ? ShieldCheck
                          : step.kind === "artifact"
                            ? FileText
                            : step.kind === "model"
                              ? Bot
                              : Settings;
                  return (
                    <li key={step.id} className="px-5 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-800">
                              {step.name}
                            </p>
                            <StatusBadge status={step.status} />
                            {step.latencyMs ? (
                              <span className="text-[11px] text-slate-400">
                                {formatDuration(step.latencyMs)}
                              </span>
                            ) : null}
                          </div>
                          {step.error ? (
                            <p className="mt-1 text-xs text-red-600">
                              {step.error}
                            </p>
                          ) : null}
                          {step.input || step.output ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] text-slate-400">
                                查看输入输出
                              </summary>
                              <pre className="wa-scrollbar mt-1 max-h-56 overflow-auto rounded bg-slate-50 p-2 text-[10px] leading-4 text-slate-600">
                                {safeJson(step.input)}
                                {step.output
                                  ? `\n---\n${safeJson(step.output)}`
                                  : ""}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="运行信息">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-400">Agent</dt>
                <dd className="text-slate-700">{agent?.name ?? "-"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">状态</dt>
                <dd>
                  <StatusBadge status={run.status} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">轮次</dt>
                <dd className="text-slate-700">{run.turns}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">工具调用</dt>
                <dd className="text-slate-700">{run.toolCalls}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Token</dt>
                <dd className="text-slate-700">
                  {run.inputTokens} / {run.outputTokens}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">成本</dt>
                <dd className="text-slate-700">{formatCost(run.costUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">开始</dt>
                <dd className="text-slate-700">{formatDate(run.startedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">结束</dt>
                <dd className="text-slate-700">{formatDate(run.finishedAt)}</dd>
              </div>
            </dl>
            {run.error ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {run.error}
              </p>
            ) : null}
            {run.output ? (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium text-slate-500">
                  最终输出
                </p>
                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  {run.output}
                </p>
              </div>
            ) : null}
          </Card>

          {approval ? (
            <Card
              title="审批"
              description={
                approval.status === "pending" ? "等待你的决定" : "已处理"
              }
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge tone="violet">{approval.toolName}</Badge>
                  <StatusBadge status={approval.status} />
                </div>
                <p className="text-xs text-slate-600">{approval.reason}</p>
                <pre className="wa-scrollbar max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px] leading-4 text-slate-600">
                  {safeJson(approval.input)}
                </pre>
                {approval.status === "pending" ? (
                  <>
                    <Field label="备注">
                      <Textarea
                        rows={2}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="可选：说明批准或拒绝的原因"
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        loading={decide.isPending}
                        disabled={!detail.data.capabilities?.canWrite}
                        onClick={() => decide.mutate("approve")}
                        className="flex-1"
                      >
                        批准并继续
                      </Button>
                      <Button
                        variant="danger"
                        loading={decide.isPending}
                        disabled={!detail.data.capabilities?.canWrite}
                        onClick={() => decide.mutate("reject")}
                        className="flex-1"
                      >
                        拒绝
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">
                    {approval.decidedAt ? relativeTime(approval.decidedAt) : ""}
                    {approval.decisionNote ? ` · ${approval.decisionNote}` : ""}
                  </p>
                )}
                <ErrorText error={decide.error} />
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <PersonalExecutionModal
        open={followUp}
        onClose={() => setFollowUp(false)}
        agents={agents.data?.items ?? []}
        defaultAgentId={run.agentId}
        conversationId={run.conversationId}
        lockAgent
        onCreated={(next) => navigate(`/tasks/${next.id}`)}
      />
    </div>
  );
}
