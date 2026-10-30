import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  get,
  Button,
  Card,
  ErrorText,
  Spinner,
  StatusBadge,
  formatDate,
} from "@workagent/ui";
type Entry = {
  id: string;
  unassigned?: boolean;
  status?: string;
  input?: string;
  output?: string | null;
  agentName?: string;
  taskId: string | null;
  taskTitle: string | null;
  attempt?: number;
  runId?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  reason?: string;
  toolName?: string;
  createdAt: string;
};
export function ProjectExecution({
  id,
  kind,
  privateDefault = false,
}: {
  id: string;
  kind: "runs" | "artifacts" | "approvals";
  privateDefault?: boolean;
}) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["project-execution", id, kind, page],
    queryFn: () =>
      get<{ items: Entry[]; total: number }>(
        `/v1/projects/${id}/${kind}?page=${page}&pageSize=20`,
      ),
    refetchInterval: 5000,
  });
  const titles = {
    runs: "执行记录",
    artifacts: "项目产物",
    approvals: "执行审批",
  };
  return (
    <section className="mt-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{titles[kind]}</h2>
        {privateDefault && (
          <p className="mt-2 text-sm text-slate-500">
            仅自己可见。包含本人未关联任务的执行与自动化执行；它们不会自动生成任务卡。
            <Link className="ml-2 text-blue-700" to="/">
              前往搭档档案发起执行 →
            </Link>
          </p>
        )}
        <p className="mt-2 text-sm text-slate-500">
          {kind === "runs"
            ? privateDefault
              ? "未关联执行可直接查看输出；关联规划任务的执行成功不等于任务验收。"
              : "每次执行独立保留；执行成功后仍需提交任务并由他人验收。"
            : kind === "artifacts"
              ? "来自本项目真实执行的文件；保留来源，下载时再次校验权限。"
              : "进入对应执行查看请求内容并审批。审批操作与任务交付验收相互独立。"}
        </p>
      </div>
      <ErrorText error={q.error} />
      {q.isPending ? (
        <Spinner />
      ) : !q.isError && !q.data?.items.length ? (
        <Card>
          <p className="text-sm text-slate-500">
            {kind === "runs"
              ? "还没有执行记录。在任务详情为任务分配企业 Agent 后发起执行；人工任务无需 Agent。"
              : kind === "artifacts"
                ? "尚无执行产物。此处只展示实际生成的文件，不将文本回复伪装成文件。"
                : "暂无执行审批。"}
          </p>
        </Card>
      ) : (
        q.data?.items.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  className="font-medium text-blue-700 break-words"
                  to={`/projects/${id}/runs/${e.runId ?? e.id}`}
                >
                  {e.name ??
                    e.toolName ??
                    e.taskTitle ??
                    (e.unassigned
                      ? "未关联任务 · 本人执行"
                      : "原任务已移除 · 保留执行")}
                </Link>
                <p className="mt-1 text-xs text-slate-500">
                  {e.agentName ? `${e.agentName} · ` : ""}
                  {e.attempt ? `第 ${e.attempt} 次执行 · ` : ""}
                  {formatDate(e.createdAt)}
                </p>
              </div>
              {e.status && <StatusBadge status={e.status} />}
            </div>
            {e.taskId && (
              <Link
                className="mt-3 inline-block text-xs text-blue-700"
                to={`/projects?project=${id}&task=${e.taskId}`}
              >
                查看任务 · {e.taskTitle}
              </Link>
            )}
            {e.input && (
              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">
                {e.input}
              </p>
            )}
            {e.output && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-blue-700">
                  查看实际输出
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {e.output}
                </p>
              </details>
            )}
            {e.reason && (
              <p className="mt-3 text-sm text-slate-600">{e.reason}</p>
            )}
            {kind === "artifacts" && (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <span className="text-slate-500">
                  {e.mimeType} · {e.size} B
                </span>
                <a
                  className="text-blue-700"
                  href={`/v1/artifacts/${e.id}/download`}
                >
                  下载文件
                </a>
              </div>
            )}
          </Card>
        ))
      )}
      {!!q.data?.total && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <Button
            variant="outline"
            disabled={page === 1 || q.isFetching}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span>
            {page} / {Math.ceil(q.data.total / 20)} · 共 {q.data.total} 条
          </span>
          <Button
            variant="outline"
            disabled={page * 20 >= q.data.total || q.isFetching}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
}
