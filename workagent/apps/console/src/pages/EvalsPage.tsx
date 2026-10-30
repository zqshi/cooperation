import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  DataTable,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  formatDate,
  get,
  post,
} from "@workagent/ui";
import type { AgentSummary, EvalDataset } from "../lib/types.js";

export function EvalsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const datasets = useQuery({
    queryKey: ["eval-datasets"],
    queryFn: () => get<{ items: EvalDataset[] }>("/v1/eval-datasets"),
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      get<{ items: AgentSummary[] }>("/v1/agents?scope=enterprise"),
  });

  const agentNames = new Map(
    (agents.data?.items ?? []).map((agent) => [agent.id, agent.name]),
  );

  const createDataset = useMutation({
    mutationFn: () =>
      post<{ dataset: EvalDataset }>("/v1/eval-datasets", {
        agentId,
        name,
        description,
      }),
    onSuccess: (data) => {
      setOpen(false);
      setName("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["eval-datasets"] });
      navigate(`/tenant/evals/${data.dataset.id}`);
    },
  });

  return (
    <div>
      <PageHeader
        title="评测"
        description="用回归集验证 Agent 的输出质量与工具调用是否正确。"
        actions={<Button onClick={() => setOpen(true)}>新建评测集</Button>}
      />

      <Card padding={false}>
        {datasets.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={datasets.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有评测集"
            onRowClick={(row) => navigate(`/tenant/evals/${row.id}`)}
            columns={[
              {
                key: "name",
                header: "名称",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-slate-400">
                      {row.description || "无描述"}
                    </p>
                  </div>
                ),
              },
              {
                key: "agent",
                header: "Agent",
                render: (row) =>
                  agentNames.get(row.agentId) ?? row.agentId.slice(0, 8),
              },
              {
                key: "cases",
                header: "用例",
                render: (row) => `${row.caseCount} 个`,
              },
              {
                key: "created",
                header: "创建时间",
                render: (row) => formatDate(row.createdAt),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title="新建评测集"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={createDataset.isPending}
              disabled={!agentId || !name.trim()}
              onClick={() => createDataset.mutate()}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Agent">
            <Select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              <option value="">选择 Agent</option>
              {agents.data?.items.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="名称">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="描述">
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <ErrorText error={createDataset.error} />
        </div>
      </Modal>
    </div>
  );
}
