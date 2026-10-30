import { ProjectExecution } from "./ProjectExecution";
import { Link } from "react-router-dom";
import { ProjectBoard } from "./ProjectBoard";
import { del } from "@workagent/ui";
import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LoginPage,
  Spinner,
  useAuth,
  get,
  post,
  put,
  Button,
  Card,
  ErrorText,
  PageHeader,
  Modal,
  Input,
  Textarea,
  Select,
  Field,
  Tabs,
  Badge,
  EmptyState,
  DataTable,
  formatDate,
} from "@workagent/ui";
import type { Project } from "@workagent/contracts";
type Member = { user_id: string; name: string; email: string; role: string };
export function ProjectsPage() {
  const { user, loading } = useAuth();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const id = params.get("project") ?? "";
  const setId = (value: string) => setParams({ project: value });
  const requestedTab = params.get("tab") ?? "board";
  const tab = [
    "board",
    "runs",
    "artifacts",
    "approvals",
    "context",
    "members",
    "activity",
  ].includes(requestedTab)
    ? requestedTab
    : "board";
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => get<{ items: Project[] }>("/v1/projects"),
    enabled: !!user,
  });
  const project = projects.data?.items.find((p) => p.id === id);
  const manager = project?.role === "manager";
  const members = useQuery({
    queryKey: ["project-members", id],
    queryFn: () => get<{ items: Member[] }>(`/v1/projects/${id}/members`),
    enabled: !!user && !!project,
  });
  const candidates = useQuery({
    queryKey: ["project-candidates", id],
    queryFn: () =>
      get<{ items: { id: string; name: string; email: string }[] }>(
        `/v1/projects/${id}/candidates`,
      ),
    enabled: !!user && manager && !project?.is_default,
  });
  const activity = useQuery({
    queryKey: ["project-activity", id],
    queryFn: () =>
      get<{
        items: {
          id: string;
          action: string;
          actorName: string | null;
          createdAt: string;
        }[];
      }>(`/v1/projects/${id}/activity`),
    enabled: !!project && tab === "activity",
  });
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["projects"] });
      await cache.invalidateQueries({ queryKey: ["project-members", id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Spinner />;
  if (!user) return <LoginPage title="登录项目协作" />;
  return (
    <>
      {!id && (
        <PageHeader
          title="项目协作"
          description="围绕交付组织任务、协作执行与验收。"
          actions={
            user.role !== "auditor" && (
              <Button onClick={() => setCreating(true)}>新建项目</Button>
            )
          }
        />
      )}
      <ErrorText
        error={error || projects.error || members.error || candidates.error}
      />
      <Modal
        open={creating}
        title="创建项目"
        onClose={() => setCreating(false)}
      >
        <form
          className="wa-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const result = await post<{ project: Project }>("/v1/projects", {
                name,
                description,
              });
              setId(result.project.id);
              setName("");
              setDescription("");
              setCreating(false);
            });
          }}
        >
          <label>
            项目名称
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border p-2"
            />
          </label>
          <label>
            说明
            <input
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="border p-2"
            />
          </label>
          <Button type="submit" disabled={busy}>
            创建项目
          </Button>
        </form>
      </Modal>
      {projects.isLoading ? (
        <Spinner />
      ) : projects.data?.items.length === 0 ? (
        <EmptyState
          title="开始一个协作项目"
          description="创建项目，邀请执行者和验收人，分配需要交付的任务。"
        />
      ) : !id ? (
        <section className="wa-project-directory" aria-label="项目目录">
          <div className="wa-project-intro">
            <div>
              <p className="text-xs font-semibold tracking-widest text-blue-700">
                PROJECT WORKSPACE
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                让每一项工作，都有清晰的归属
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                先进入项目，再规划任务、安排人或 Agent
                执行，跟进产物并独立验收。
              </p>
            </div>
            <span className="wa-project-total">
              {projects.data?.items.length ?? 0}
              <small>我参与的项目</small>
            </span>
          </div>
          <Field label="查找项目">
            <Input
              placeholder="搜索项目名称或说明"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <div className="wa-project-grid">
            {projects.data?.items
              .filter((p) =>
                `${p.name} ${p.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((p) => (
                <Link
                  key={p.id}
                  to={`/projects?project=${p.id}`}
                  className="wa-project-card"
                >
                  <span className="wa-project-symbol">
                    {p.name.slice(0, 1)}
                  </span>
                  <Badge>
                    {p.is_default
                      ? "置顶 · 私有默认项目"
                      : p.role === "manager"
                        ? "项目管理"
                        : p.role === "viewer"
                          ? "只读"
                          : "参与协作"}
                  </Badge>
                  <h3>{p.name}</h3>
                  <p>{p.description || "从任务规划开始，沉淀执行与交付。"}</p>
                  <footer>
                    <span>创建于 {formatDate(p.created_at)}</span>
                    <strong>进入项目 →</strong>
                  </footer>
                </Link>
              ))}
          </div>
          {!!search &&
            !projects.data?.items.some((p) =>
              `${p.name} ${p.description}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ) && (
              <EmptyState
                title="没有匹配的项目"
                description="试试其他关键词。这里只显示你已加入的项目。"
              />
            )}
        </section>
      ) : null}

      {!project && id && !projects.isLoading && (
        <div>
          <PageHeader
            title="项目不可访问"
            description="项目需要单独的成员授权；请返回项目目录选择。"
          />
          <Link to="/projects" className="text-blue-700">
            ← 全部项目
          </Link>
        </div>
      )}
      {project && (
        <section>
          <Link
            className="mb-5 inline-block text-sm text-blue-700"
            to="/projects"
          >
            ← 全部项目
          </Link>
          <PageHeader
            title={project.name}
            description={project.description}
            actions={
              <Badge>
                {project.is_default
                  ? "私有默认项目"
                  : manager
                    ? "项目管理"
                    : "项目协作"}
              </Badge>
            }
          />
          {project.is_default && (
            <p className="mb-4 text-sm text-slate-500">
              这是不可共享的私人空间。规划任务与执行记录分别保留；需要他人独立验收的工作请使用协作项目。
            </p>
          )}
          <Tabs
            active={tab}
            onChange={(value) => setParams({ project: id, tab: value })}
            tabs={[
              { key: "board", label: "任务看板" },
              { key: "runs", label: "执行记录" },
              { key: "approvals", label: "执行审批" },
              { key: "artifacts", label: "项目产物" },
              { key: "context", label: "项目上下文" },
              { key: "members", label: "项目成员" },
              { key: "activity", label: "项目动态" },
            ]}
          />
          {["runs", "artifacts", "approvals"].includes(tab) && (
            <ProjectExecution
              key={`${id}:${tab}`}
              id={id}
              privateDefault={project.is_default}
              kind={tab as "runs" | "artifacts" | "approvals"}
            />
          )}
          {tab === "context" && (
            <Card className="mt-5" title="项目背景">
              <p className="wa-prose text-sm">
                {project.description || "创建项目时尚未填写背景。"}
              </p>
              <p className="mt-5 text-sm text-slate-500">
                每项任务的上下文与验收要求在任务详情维护，并随该任务传给执行
                Agent。项目背景目前不自动注入执行，也未开放项目知识发布。
              </p>
            </Card>
          )}
          {tab === "board" && (
            <ProjectBoard
              key={id}
              id={id}
              role={project.role}
              members={members.data?.items ?? []}
            />
          )}
          {tab === "activity" && (
            <Card
              className="mt-5"
              title="最近动态"
              description="最近 50 条项目协作记录"
              padding={false}
            >
              <ErrorText error={activity.error} />
              {activity.isLoading ? (
                <Spinner />
              ) : (
                <DataTable
                  rows={activity.data?.items ?? []}
                  keyFor={(a) => a.id}
                  columns={[
                    {
                      key: "action",
                      header: "操作",
                      render: (a) =>
                        ({
                          "project.create": "创建项目",
                          "project.task.create": "创建任务",
                          "project.task.todo": "更新待办任务",
                          "project.task.doing": "开始或更新执行",
                          "project.task.review": "提交验收",
                          "project.task.done": "验收通过",
                          "project.task.delete": "删除任务",
                          "project.task.attempt": "发起 Agent 执行",
                          "project.task.reference": "引用产物",
                          "project.member.set": "更新成员",
                          "project.member.remove": "移除成员",
                          "project.transfer": "转移项目所有权",
                          "project.default.create": "初始化私有默认项目",
                        })[a.action] ?? "项目更新",
                    },
                    {
                      key: "actor",
                      header: "操作人",
                      render: (a) => a.actorName ?? "—",
                    },
                    {
                      key: "time",
                      header: "时间",
                      render: (a) => formatDate(a.createdAt),
                    },
                  ]}
                />
              )}
            </Card>
          )}
          {tab === "members" && (
            <Card className="mt-5" title="项目成员">
              {members.isLoading ? (
                <Spinner />
              ) : (
                members.data?.items.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-3 text-sm"
                  >
                    {m.name} · {m.email} ·{" "}
                    {
                      {
                        manager: "项目管理",
                        contributor: "参与协作",
                        viewer: "只读",
                      }[m.role]
                    }
                    {manager &&
                      !project.is_default &&
                      m.user_id !== user.id && (
                        <>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                del(`/v1/projects/${id}/members/${m.user_id}`),
                              )
                            }
                          >
                            移除
                          </Button>
                          {project.created_by === user.id && (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  post(`/v1/projects/${id}/transfer`, {
                                    userId: m.user_id,
                                  }),
                                )
                              }
                            >
                              转移所有权
                            </Button>
                          )}
                        </>
                      )}
                  </div>
                ))
              )}
              {manager && !project.is_default && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() =>
                      put(`/v1/projects/${id}/members`, {
                        userId: target,
                        role,
                      }),
                    );
                  }}
                >
                  <label>
                    企业成员
                    <select
                      required
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className="border p-2"
                    >
                      <option value="">选择成员</option>
                      {candidates.data?.items
                        .filter((c) => c.id !== user.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.email})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label htmlFor="project-member-role">
                    权限
                    <select
                      id="project-member-role"
                      aria-label="权限"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="border p-2"
                    >
                      <option value="viewer">只读</option>
                      <option value="contributor">参与者</option>
                      <option value="manager">管理者</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={busy || !target}>
                    添加或更新权限
                  </Button>
                </form>
              )}
            </Card>
          )}
        </section>
      )}
    </>
  );
}
