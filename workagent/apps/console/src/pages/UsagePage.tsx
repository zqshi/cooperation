import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Stat,
  formatCost,
  formatDate,
  get,
  patch,
} from "@workagent/ui";

type UsageSummary = {
  from: string;
  to: string;
  totalCostUsd: number;
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byAgent: Array<{
    agent_id: string;
    name: string | null;
    runs: number;
    cost_usd: number;
  }>;
  byDay: Array<{ date: string; runs: number; cost_usd: number }>;
};

type QuotaRow = {
  id: string;
  scope: string;
  scope_id: string;
  monthly_budget_usd: number;
  monthly_run_limit: number;
  current_cost_usd: number;
  current_runs: number;
};

export function UsagePage() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const [editQuota, setEditQuota] = useState<QuotaRow | null>(null);
  const [budget, setBudget] = useState(0);
  const [runLimit, setRunLimit] = useState(0);

  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const usage = useQuery({
    queryKey: ["usage", days],
    queryFn: () => get<{ summary: UsageSummary }>(`/v1/usage?from=${from}`),
  });
  const quotas = useQuery({
    queryKey: ["quotas"],
    queryFn: async () => {
      const data = await get<{ items: QuotaRow[] }>("/v1/quotas");
      return {
        items: data.items.map((row) => ({
          ...row,
          monthly_budget_usd: Number(row.monthly_budget_usd),
          current_cost_usd: Number(row.current_cost_usd),
        })),
      };
    },
  });

  const saveQuota = useMutation({
    mutationFn: () =>
      patch(`/v1/quotas/${editQuota?.id}`, {
        monthlyBudgetUsd: budget,
        monthlyRunLimit: runLimit,
      }),
    onSuccess: () => {
      setEditQuota(null);
      void queryClient.invalidateQueries({ queryKey: ["quotas"] });
    },
  });

  const summary = usage.data?.summary;
  const maxDayCost = Math.max(
    0.0001,
    ...(summary?.byDay.map((day) => day.cost_usd) ?? [0]),
  );

  return (
    <div>
      <PageHeader
        title="成本与配额"
        description="模型调用、工具和沙箱的成本都会计入预算。"
        actions={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {[7, 30, 90].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  days === value
                    ? "bg-white font-medium shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {value} 天
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="总成本"
          value={formatCost(summary?.totalCostUsd)}
          tone="green"
        />
        <Stat label="运行数" value={summary?.totalRuns ?? "-"} tone="blue" />
        <Stat
          label="输入 Token"
          value={(summary?.totalInputTokens ?? 0).toLocaleString()}
        />
        <Stat
          label="输出 Token"
          value={(summary?.totalOutputTokens ?? 0).toLocaleString()}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="每日成本" className="lg:col-span-2">
          {usage.isLoading ? (
            <Spinner />
          ) : (summary?.byDay.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">暂无数据</p>
          ) : (
            <div className="flex h-48 items-end gap-1">
              {summary?.byDay.map((day) => (
                <div
                  key={day.date}
                  className="group flex flex-1 flex-col items-center justify-end"
                >
                  <div
                    className="w-full rounded-t bg-blue-500/80 transition group-hover:bg-blue-600"
                    style={{
                      height: `${Math.max(2, (day.cost_usd / maxDayCost) * 100)}%`,
                    }}
                    title={`${day.date}: ${formatCost(day.cost_usd)}`}
                  />
                  <span className="mt-1 hidden text-[9px] text-slate-400 sm:block">
                    {day.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="配额" padding={false}>
          {quotas.isLoading ? (
            <Spinner />
          ) : (quotas.data?.items.length ?? 0) === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-400">
              暂无配额
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {quotas.data?.items.map((quota) => (
                <li
                  key={quota.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-800">
                      {quota.scope} · {quota.scope_id.slice(0, 8)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatCost(quota.current_cost_usd)} /{" "}
                      {formatCost(quota.monthly_budget_usd)} ·{" "}
                      {quota.current_runs}/{quota.monthly_run_limit} 次
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => {
                      setEditQuota(quota);
                      setBudget(quota.monthly_budget_usd);
                      setRunLimit(quota.monthly_run_limit);
                    }}
                  >
                    调整
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6" title="按 Agent" padding={false}>
        <DataTable
          rows={summary?.byAgent ?? []}
          keyFor={(row) => row.agent_id}
          empty="暂无数据"
          columns={[
            {
              key: "name",
              header: "Agent",
              render: (row) => row.name ?? row.agent_id.slice(0, 8),
            },
            { key: "runs", header: "运行", render: (row) => row.runs },
            {
              key: "cost",
              header: "成本",
              render: (row) => (
                <Badge tone="green">{formatCost(row.cost_usd)}</Badge>
              ),
            },
            {
              key: "avg",
              header: "单次成本",
              render: (row) =>
                formatCost(row.runs === 0 ? 0 : row.cost_usd / row.runs),
            },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(editQuota)}
        title="调整配额"
        onClose={() => setEditQuota(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditQuota(null)}>
              取消
            </Button>
            <Button
              loading={saveQuota.isPending}
              onClick={() => saveQuota.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="月预算（USD）">
            <Input
              type="number"
              step="1"
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </Field>
          <Field label="月运行次数上限">
            <Input
              type="number"
              value={runLimit}
              onChange={(event) => setRunLimit(Number(event.target.value))}
            />
          </Field>
          <ErrorText error={saveQuota.error} />
        </div>
      </Modal>
    </div>
  );
}
