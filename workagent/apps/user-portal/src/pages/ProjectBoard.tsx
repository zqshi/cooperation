import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  get,
  post,
  patch,
  del,
  Button,
  Card,
  ErrorText,
  useAuth,
  Modal,
  Field,
  Input,
  Textarea,
  Select,
  Badge,
  Spinner,
  StatusBadge,
} from "@workagent/ui";
import type { ProjectTask } from "@workagent/contracts";
const states = ["todo", "doing", "review", "done"] as const;
const labels = {
  todo: "待办",
  doing: "执行中",
  review: "待验收",
  done: "已验收",
};
export function ProjectBoard({
  id,
  role,
  members,
}: {
  id: string;
  role: string;
  members: { user_id: string; name: string; role: string }[];
}) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("task") ?? "";
  const select = (task: string) => {
    const next = new URLSearchParams(params);
    if (task) next.set("task", task);
    else next.delete("task");
    setParams(next);
  };
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssignee] = useState("");
  const [agentId, setAgent] = useState("");
  const [filter, setFilter] = useState("");
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const base = `/v1/projects/${id}/tasks`;
  const write = role !== "viewer";
  const tasks = useQuery({
    queryKey: ["project-tasks", id],
    queryFn: () => get<{ items: ProjectTask[] }>(base),
  });
  const agents = useQuery({
    queryKey: ["agents", "enterprise"],
    queryFn: () =>
      get<{
        items: {
          id: string;
          name: string;
          status: string;
          personal?: boolean;
        }[];
      }>("/v1/agents?scope=enterprise"),
    enabled: write,
  });
  const refs = useQuery({
    queryKey: ["task-references", id, selected],
    queryFn: () =>
      get<{
        attempts: {
          run_id: string;
          attempt: number;
          status: string;
          output: string | null;
        }[];
        artifacts: {
          id: string;
          name: string;
          run_id: string;
          referenced: boolean;
        }[];
      }>(`${base}/${selected}/references`),
    enabled: !!selected,
  });
  const task = tasks.data?.items.find((t) => t.id === selected);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["project-tasks", id] });
      await cache.invalidateQueries({ queryKey: ["project-execution", id] });
      await cache.invalidateQueries({ queryKey: ["task-references", id] });
    } catch (e) {
      setError(e);
      await cache.invalidateQueries({ queryKey: ["project-tasks", id] });
    } finally {
      setBusy(false);
    }
  }
  const memberOptions = members
    .filter(
      (m) =>
        m.role !== "viewer" && (role === "manager" || m.user_id === user?.id),
    )
    .map((m) => (
      <option key={m.user_id} value={m.user_id}>
        {m.name}
      </option>
    ));
  const agentOptions = agents.data?.items
    .filter((a) => a.status === "published" && !a.personal)
    .map((a) => (
      <option key={a.id} value={a.id}>
        {a.name}
      </option>
    ));
  const filtered =
    tasks.data?.items.filter(
      (t) =>
        t.title.toLowerCase().includes(filter.toLowerCase()) &&
        (!mine || t.assignee_id === user?.id),
    ) ?? [];
  const transition = (t: ProjectTask, status: string) =>
    void act(() => patch(`${base}/${t.id}`, { version: t.version, status }));
  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-64"
            aria-label="筛选任务"
            placeholder="搜索任务标题"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
            />
            只看我负责
          </label>
        </div>
        {write && (
          <Button
            onClick={() => {
              setError(undefined);
              setCreating(true);
            }}
          >
            新建任务
          </Button>
        )}
      </div>
      <ErrorText error={tasks.error} />
      {!selected && !creating && <ErrorText error={error} />}
      {tasks.isLoading ? (
        <Spinner />
      ) : (
        <div className="wa-board">
          {states.map((status) => (
            <div key={status} className="wa-board-column">
              <h3 className="mb-3 flex items-center justify-between text-sm font-semibold">
                {labels[status]}
                <Badge>
                  {filtered.filter((t) => t.status === status).length}
                </Badge>
              </h3>
              {filtered
                .filter((t) => t.status === status)
                .map((t) => (
                  <button
                    className="wa-task-tile"
                    key={t.id}
                    onClick={() => {
                      setEditing(null);
                      setError(undefined);
                      select(t.id);
                    }}
                  >
                    <span className="block text-sm font-semibold">
                      {t.title}
                    </span>
                    <span className="mt-2 block line-clamp-2 text-xs text-slate-500">
                      {t.description || "暂无补充要求"}
                    </span>
                    <span className="mt-4 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {members.find((m) => m.user_id === t.assignee_id)
                          ?.name || "待指派"}
                      </span>
                      <Badge>{t.agent_id ? "Agent 协助" : "人工执行"}</Badge>
                    </span>
                  </button>
                ))}
              {!filtered.some((t) => t.status === status) && (
                <p className="py-10 text-center text-xs text-slate-400">
                  暂无任务
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={creating}
        title="新建项目任务"
        onClose={() => {
          if (!busy) setCreating(false);
        }}
      >
        <form
          className="wa-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await post(base, {
                title,
                description,
                assigneeId: assigneeId || null,
                agentId: agentId || null,
              });
              setCreating(false);
              setTitle("");
              setDescription("");
              setAssignee("");
              setAgent("");
            });
          }}
        >
          <Field label="任务标题">
            <Input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="上下文与验收要求">
            <Textarea
              rows={5}
              maxLength={20000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="执行者">
            <Select
              aria-label="执行者"
              value={assigneeId}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">待指派</option>
              {memberOptions}
            </Select>
          </Field>
          <p className="text-xs text-slate-500">
            任务独立于执行载体。人工任务无需 Agent
            或模型配置；可在任务详情后续调整。
          </p>
          <Field label="Agent（可选）">
            <Select
              aria-label="任务 Agent"
              value={agentId}
              onChange={(e) => setAgent(e.target.value)}
            >
              <option value="">人工执行</option>
              {agentOptions}
            </Select>
          </Field>
          <ErrorText error={agents.error || error} />
          <Button loading={busy} type="submit">
            创建任务
          </Button>
        </form>
      </Modal>
      <Modal
        drawer
        open={!!selected}
        title={task?.title ?? "任务详情"}
        description={
          task ? `${labels[task.status]} · 版本 ${task.version}` : undefined
        }
        onClose={() => {
          if (!busy) {
            select("");
            setEditing(null);
          }
        }}
        wide
      >
        <ErrorText error={error || refs.error} />
        {!task ? (
          <p>任务已移除或不可访问。</p>
        ) : (
          <div className="space-y-5">
            {editing ? (
              <form
                className="wa-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await patch(`${base}/${editing.id}`, {
                      version: editing.version,
                      title: editing.title,
                      description: editing.description,
                      ...(role === "manager"
                        ? {
                            assigneeId: editing.assignee_id,
                            agentId: editing.agent_id,
                          }
                        : {}),
                    });
                    setEditing(null);
                  });
                }}
              >
                <Field label="编辑标题">
                  <Input
                    required
                    maxLength={200}
                    value={editing.title}
                    onChange={(e) =>
                      setEditing({ ...editing, title: e.target.value })
                    }
                  />
                </Field>
                <Field label="编辑上下文">
                  <Textarea
                    rows={6}
                    maxLength={20000}
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                  />
                </Field>
                {role === "manager" && (
                  <>
                    <Field label="重新指派">
                      <Select
                        aria-label="调整执行者"
                        value={editing.assignee_id ?? ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            assignee_id: e.target.value || null,
                          })
                        }
                      >
                        <option value="">待指派</option>
                        {memberOptions}
                      </Select>
                    </Field>
                    <Field label="执行 Agent">
                      <Select
                        value={editing.agent_id ?? ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            agent_id: e.target.value || null,
                          })
                        }
                      >
                        <option value="">人工执行</option>
                        {agentOptions}
                      </Select>
                    </Field>
                  </>
                )}
                <div className="flex gap-2">
                  <Button type="submit" loading={busy}>
                    保存任务
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setEditing(null)}
                  >
                    取消编辑
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p className="wa-prose text-sm">
                  {task.description || "暂无上下文与验收要求。"}
                </p>
                <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                  <span>
                    执行者：
                    {members.find((m) => m.user_id === task.assignee_id)
                      ?.name || "待指派"}
                  </span>
                  <span>
                    {task.agent_id
                      ? `Agent：${agents.data?.items.find((a) => a.id === task.agent_id)?.name ?? "已关联"}`
                      : "人工执行"}
                  </span>
                </div>
              </>
            )}
            {write &&
              (role === "manager" || task.assignee_id === user?.id) &&
              task.status !== "done" &&
              !editing && (
                <div className="flex flex-wrap gap-2 border-y border-slate-100 py-4">
                  {task.status !== "review" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setEditing({ ...task })}
                    >
                      编辑任务
                    </Button>
                  )}
                  {task.status === "todo" && (
                    <Button
                      disabled={busy}
                      onClick={() => transition(task, "doing")}
                    >
                      开始
                    </Button>
                  )}
                  {task.status === "doing" && task.assignee_id === user?.id && (
                    <Button
                      disabled={busy}
                      onClick={() => transition(task, "review")}
                    >
                      提交验收
                    </Button>
                  )}
                  {role === "manager" && task.status === "review" && (
                    <>
                      <Button
                        disabled={
                          busy ||
                          task.assignee_id === user?.id ||
                          task.submitted_by === user?.id
                        }
                        onClick={() => transition(task, "done")}
                      >
                        验收通过
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => transition(task, "doing")}
                      >
                        退回
                      </Button>
                    </>
                  )}
                  {task.agent_id &&
                    task.assignee_id === user?.id &&
                    task.status !== "review" && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            post(`${base}/${task.id}/attempts`, {
                              key: crypto.randomUUID(),
                            }),
                          )
                        }
                      >
                        运行 Agent
                      </Button>
                    )}
                  {role === "manager" && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("删除这个任务？执行历史仍保留。"))
                          void act(async () => {
                            await del(`${base}/${task.id}`);
                            select("");
                          });
                      }}
                    >
                      删除任务
                    </Button>
                  )}
                </div>
              )}
            {task.status === "review" && (
              <p className="text-xs text-slate-500">
                由未参与执行与提交的项目管理成员独立验收。
              </p>
            )}
            <div>
              <h3 className="mb-3 text-sm font-semibold">执行尝试与产物</h3>
              {refs.isLoading ? (
                <Spinner />
              ) : !refs.data?.attempts.length ? (
                <p className="text-sm text-slate-500">
                  暂无 Agent 执行尝试。人工任务可直接提交验收。
                </p>
              ) : (
                refs.data.attempts.map((a) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"
                    key={a.run_id}
                  >
                    <Link
                      className="text-blue-700"
                      to={`/projects/${id}/runs/${a.run_id}`}
                    >
                      第 {a.attempt} 次执行 →
                    </Link>
                    <StatusBadge status={a.status} />
                    {a.output && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-blue-700">
                          实际输出
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap break-words text-slate-600">
                          {a.output}
                        </p>
                      </details>
                    )}
                  </div>
                ))
              )}
              {refs.data?.artifacts.map((a) => (
                <div
                  className="mt-3 flex items-center justify-between gap-2"
                  key={a.id}
                >
                  <a
                    className="text-sm text-blue-700"
                    href={`/v1/artifacts/${a.id}/download`}
                  >
                    {a.name} ↓
                  </a>
                  {write && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || a.referenced}
                      onClick={() =>
                        void act(() =>
                          post(`${base}/${selected}/references`, {
                            artifactId: a.id,
                          }),
                        )
                      }
                    >
                      {a.referenced ? "已引用" : "引用产物"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
