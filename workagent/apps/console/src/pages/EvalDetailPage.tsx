import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
  formatCost,
  formatDate,
  formatDuration,
  get,
  post,
  del,
} from "@workagent/ui";
import type { EvalCase, EvalDataset, EvalResult } from "@workagent/contracts";

type EvalRunRecord = {
  id: string;
  dataset_id: string;
  agent_revision_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export function EvalDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [assertionsText, setAssertionsText] = useState("[]");

  const dataset = useQuery({
    queryKey: ["eval-dataset", id],
    queryFn: () =>
      get<{ dataset: EvalDataset; cases: EvalCase[] }>(`/v1/eval-datasets/${id}`),
    enabled: Boolean(id),
  });

  const runs = useQuery({
    queryKey: ["eval-runs", id],
    queryFn: () => get<{ items: EvalRunRecord[] }>(`/v1/eval-runs?datasetId=${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((run) => run.status === "queued" || run.status === "running") ? 2000 : false;
    },
  });

  const startRun = useMutation({
    mutationFn: () => post<{ evalRun: EvalRunRecord }>("/v1/eval-runs", { datasetId: id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["eval-runs", id] }),
  });

  const addCase = useMutation({
    mutationFn: () =>
      post<{ case: EvalCase }>(`/v1/eval-datasets/${id}/cases`, {
        name,
        input,
        expected: expected || undefined,
        assertions: JSON.parse(assertionsText),
      }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setInput("");
      setExpected("");
      setAssertionsText("[]");
      void queryClient.invalidateQueries({ queryKey: ["eval-dataset", id] });
      void queryClient.invalidateQueries({ queryKey: ["eval-datasets"] });
    },
  });

  const removeCase = useMutation({
    mutationFn: (caseId: string) => del(`/v1/eval-cases/${caseId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["eval-dataset", id] }),
  });

  if (dataset.isLoading) return <Spinner />;
  if (dataset.error) return <ErrorText error={dataset.error} />;

  const latest = runs.data?.items[0];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link to="/tenant/evals" className="text-slate-400 hover:text-slate-600">
              评测
            </Link>
            <span className="text-slate-300">/</span>
            {dataset.data?.dataset.name}
          </span>
        }
        description={dataset.data?.dataset.description}
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(true)}>
              添加用例
            </Button>
            <Button
              loading={startRun.isPending}
              onClick={() => startRun.mutate()}
              disabled={(dataset.data?.cases.length ?? 0) === 0}
            >
              运行评测
            </Button>
          </>
        }
      />

      <ErrorText error={startRun.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`用例（${dataset.data?.cases.length ?? 0}）`} className="lg:col-span-2" padding={false}>
          <DataTable
            rows={dataset.data?.cases ?? []}
            keyFor={(row) => row.id}
            empty="还没有用例"
            columns={[
              {
                key: "name",
                header: "用例",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="mt-0.5 line-clamp-2 max-w-lg text-xs text-slate-400">{row.input}</p>
                  </div>
                ),
              },
              {
                key: "expected",
                header: "期望",
                render: (row) => (
                  <span className="line-clamp-2 max-w-xs text-xs text-slate-500">
                    {row.expected || "-"}
                  </span>
                ),
              },
              {
                key: "assertions",
                header: "断言",
                render: (row) => (
                  <div className="flex flex-wrap gap-1">
                    {row.assertions.map((assertion, index) => (
                      <Badge key={index} tone="violet">
                        {assertion.type}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => removeCase.mutate(row.id)}
                  >
                    删除
                  </button>
                ),
              },
            ]}
          />
        </Card>

        <Card title="最近运行" padding={false}>
          {runs.isLoading ? (
            <Spinner />
          ) : !latest ? (
            <p className="px-5 py-8 text-center text-xs text-slate-400">还没有运行记录</p>
          ) : (
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <StatusBadge status={latest.status} />
                <span className="text-xs text-slate-400">{formatDate(latest.created_at)}</span>
              </div>
              <div>
                <p className="text-3xl font-semibold text-slate-900">
                  {latest.total === 0 ? 0 : Math.round((latest.passed / latest.total) * 100)}%
                </p>
                <p className="text-xs text-slate-500">
                  {latest.passed} 通过 / {latest.failed} 失败
                </p>
              </div>
              <div className="space-y-2">
                {latest.results.map((result) => (
                  <div
                    key={result.caseId}
                    className="rounded-lg border border-slate-100 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <Badge tone={result.passed ? "green" : "red"}>
                        {result.passed ? "通过" : "失败"}
                      </Badge>
                      <span className="text-slate-400">
                        {formatDuration(result.latencyMs)} · {formatCost(result.costUsd)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-slate-600">{result.output}</p>
                    {result.failures.length > 0 ? (
                      <ul className="mt-1 list-inside list-disc text-red-600">
                        {result.failures.map((failure, index) => (
                          <li key={index}>{failure}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6" title="历史运行" padding={false}>
        <DataTable
          rows={runs.data?.items ?? []}
          keyFor={(row) => row.id}
          empty="还没有运行记录"
          columns={[
            { key: "time", header: "时间", render: (row) => formatDate(row.created_at) },
            { key: "status", header: "状态", render: (row) => <StatusBadge status={row.status} /> },
            {
              key: "score",
              header: "通过率",
              render: (row) =>
                row.total === 0 ? "-" : `${Math.round((row.passed / row.total) * 100)}%`,
            },
            { key: "total", header: "用例数", render: (row) => row.total },
            { key: "finished", header: "完成时间", render: (row) => formatDate(row.finished_at) },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="添加用例"
        wide
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={addCase.isPending}
              disabled={!name.trim() || !input.trim()}
              onClick={() => addCase.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="输入">
            <Textarea rows={5} value={input} onChange={(event) => setInput(event.target.value)} />
          </Field>
          <Field label="期望包含" hint="可选。输出必须包含该文本。">
            <Input value={expected} onChange={(event) => setExpected(event.target.value)} />
          </Field>
          <Field
            label="断言（JSON 数组）"
            hint='示例：[{"type":"contains","value":"已发货"},{"type":"tool_called","value":"lookup_order"}]'
          >
            <Textarea
              rows={5}
              className="font-mono text-xs"
              value={assertionsText}
              onChange={(event) => setAssertionsText(event.target.value)}
            />
          </Field>
          <ErrorText error={addCase.error} />
        </div>
      </Modal>
    </div>
  );
}
