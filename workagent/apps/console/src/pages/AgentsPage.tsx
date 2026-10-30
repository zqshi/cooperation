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
  StatusBadge,
  Textarea,
  formatDate,
  get,
  post,
} from "@workagent/ui";
import type { AgentDetail, AgentSummary } from "../lib/types.js";

export function AgentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [visibility, setVisibility] = useState("org");

  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      get<{ items: AgentSummary[] }>("/v1/agents?scope=enterprise"),
  });

  const createAgent = useMutation({
    mutationFn: () =>
      post<AgentDetail>("/v1/agents", {
        definition: {
          name,
          description,
          instructions,
          visibility,
        },
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      setOpen(false);
      navigate(`/tenant/agents/${data.agent.id}`);
    },
  });

  return (
    <div>
      <PageHeader
        title="Agent 管理"
        description="装配、发布和版本化你的数字员工。"
        actions={<Button onClick={() => setOpen(true)}>新建 Agent</Button>}
      />

      <ErrorText error={agents.error} />
      <Card padding={false}>
        {agents.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={agents.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有 Agent，先创建一个"
            onRowClick={(row) => navigate(`/tenant/agents/${row.id}`)}
            columns={[
              {
                key: "name",
                header: "名称",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-slate-400">
                      {row.description}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "状态",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "version",
                header: "版本",
                render: (row) =>
                  row.publishedVersion ? `v${row.publishedVersion}` : "-",
              },
              {
                key: "visibility",
                header: "可见性",
                render: (row) => row.visibility,
              },
              {
                key: "updated",
                header: "更新时间",
                render: (row) => formatDate(row.updatedAt),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title="新建 Agent"
        description="先创建草稿，之后在详情页装配 Skill、Connector 和知识库。"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={createAgent.isPending}
              disabled={!name.trim() || !instructions.trim()}
              onClick={() => createAgent.mutate()}
            >
              创建草稿
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="起步定义">
            <Select
              defaultValue=""
              onChange={(e) => {
                const starters: Record<string, [string, string, string]> = {
                  meeting: [
                    "会议整理助手",
                    "从会议记录整理决定和待办",
                    "仅依据用户提供的会议内容，输出摘要、已确定的决定、待办事项（责任人和期限仅在原文明确时填写）以及未解决问题。不要虚构事实、参与人、系统访问或执行结果。",
                  ],
                  writing: [
                    "文稿校对助手",
                    "校对用户提供的文字并给出修改建议",
                    "阅读用户提供的文稿，检查错别字、逻辑和表达。先列出问题，再提供修订稿；保留原意，标注待核实的信息，不编造事实或外部查询结果。",
                  ],
                };
                const v = starters[e.target.value];
                if (v) {
                  setName(v[0]);
                  setDescription(v[1]);
                  setInstructions(v[2]);
                }
              }}
            >
              <option value="">自定义空白草稿</option>
              <option value="meeting">会议整理</option>
              <option value="writing">文稿校对</option>
            </Select>
          </Field>
          <Field label="名称">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：售后客服助手"
            />
          </Field>
          <Field label="一句话描述">
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="它负责什么工作，交付什么结果"
            />
          </Field>
          <Field label="系统指令" hint="写清楚角色、边界、工作方式和输出要求。">
            <Textarea
              rows={8}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="你是一个……先判断……不知道时……"
            />
          </Field>
          <Field label="可见性">
            <Select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value)}
            >
              <option value="private">仅自己</option>
              <option value="org">组织内</option>
              <option value="public">公开</option>
            </Select>
          </Field>
          <ErrorText error={createAgent.error} />
        </div>
      </Modal>
    </div>
  );
}
