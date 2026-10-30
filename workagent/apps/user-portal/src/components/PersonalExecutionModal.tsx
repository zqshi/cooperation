import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  ErrorText,
  Field,
  Modal,
  Select,
  Textarea,
  post,
  get,
} from "@workagent/ui";
import type { AgentSummary, Run } from "@workagent/contracts";

export function PersonalExecutionModal({
  open,
  onClose,
  agents,
  defaultAgentId,
  conversationId,
  lockAgent,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  agents: AgentSummary[];
  defaultAgentId?: string;
  conversationId?: string;
  lockAgent?: boolean;
  onCreated: (run: Run) => void;
}) {
  const readiness = useQuery({
    queryKey: ["execution-readiness"],
    queryFn: () =>
      get<{ modelConfigured: boolean; canExecute: boolean }>(
        "/v1/execution-readiness",
      ),
    enabled: open,
  });
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setAgentId(defaultAgentId ?? agents[0]?.id ?? "");
      setMessage("");
    }
  }, [open, defaultAgentId]);

  const createRun = useMutation({
    mutationFn: () =>
      post<{ run: Run }>("/v1/runs", {
        agentId,
        message,
        conversationId,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (data) => {
      onCreated(data.run);
      onClose();
    },
  });

  const selected = agents.find((agent) => agent.id === agentId);

  return (
    <Modal
      open={open}
      title="个人执行"
      description="这是独立的个人执行，不会创建项目任务。项目交付请进入项目空间规划。"
      onClose={() => {
        if (!createRun.isPending) onClose();
      }}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={createRun.isPending}
            disabled={
              !agentId ||
              !message.trim() ||
              readiness.isLoading ||
              readiness.isError ||
              readiness.data?.canExecute === false
            }
            onClick={() => createRun.mutate()}
          >
            开始执行
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {readiness.data?.canExecute === false && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            模型服务尚未配置。请联系企业管理员准备模型服务后执行；项目人工任务可以继续使用。
          </p>
        )}
        <ErrorText error={readiness.error} />

        {!lockAgent ? (
          <Field label="选择 Agent">
            <Select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.personal ? "我的搭档" : "企业 Agent"} · {agent.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {selected ? (
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <p className="font-medium text-slate-800">{selected.name}</p>
            <p className="mt-0.5">{selected.description || "暂无描述"}</p>
          </div>
        ) : null}
        <Field label="任务描述" hint="写清楚背景、目标、约束和期望的输出形式。">
          <Textarea
            rows={8}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="例如：客户反馈订单 A1001 三天未发货，请查询订单状态，并按售后规范起草回复。"
          />
        </Field>
        <ErrorText error={createRun.error} />
      </div>
    </Modal>
  );
}
