import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  PageHeader,
  Spinner,
  formatDate,
  get,
} from "@workagent/ui";

type AuditRow = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
};

export function AuditPage() {
  const [resourceType, setResourceType] = useState("");
  const [action, setAction] = useState("");
  const [filters, setFilters] = useState({ resourceType: "", action: "" });

  const audit = useQuery({
    queryKey: ["audit", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.resourceType) params.set("resourceType", filters.resourceType);
      if (filters.action) params.set("action", filters.action);
      return get<{ items: AuditRow[] }>(`/v1/audit?${params.toString()}`);
    },
  });

  return (
    <div>
      <PageHeader
        title="审计日志"
        description="记录登录、配置变更、发布、审批与运行结果，满足追责与合规需求。"
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input
              placeholder="资源类型"
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value)}
            />
          </div>
          <div className="w-40">
            <Input
              placeholder="动作，如 agent.publish"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            />
          </div>
          <Button onClick={() => setFilters({ resourceType, action })}>筛选</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setResourceType("");
              setAction("");
              setFilters({ resourceType: "", action: "" });
            }}
          >
            重置
          </Button>
        </div>
      </Card>

      <Card padding={false}>
        {audit.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={audit.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="没有审计记录"
            columns={[
              {
                key: "action",
                header: "动作",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-800">{row.action}</p>
                    <p className="text-xs text-slate-400">{row.actor_name ?? "系统"}</p>
                  </div>
                ),
              },
              {
                key: "resource",
                header: "资源",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Badge>{row.resource_type}</Badge>
                    <span className="text-xs text-slate-400">{row.resource_id?.slice(0, 8) ?? "-"}</span>
                  </div>
                ),
              },
              {
                key: "metadata",
                header: "详情",
                render: (row) => (
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500">查看</summary>
                    <pre className="wa-scrollbar mt-1 max-w-xs overflow-auto rounded bg-slate-50 p-2 text-[10px] leading-4 text-slate-600">
                      {JSON.stringify(row.metadata, null, 2)}
                    </pre>
                  </details>
                ),
              },
              { key: "ip", header: "IP", render: (row) => row.ip ?? "-" },
              { key: "time", header: "时间", render: (row) => formatDate(row.created_at) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
