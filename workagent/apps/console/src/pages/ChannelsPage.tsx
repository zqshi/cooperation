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
  Select,
  Spinner,
  StatusBadge,
  formatDate,
  get,
  patch,
  post,
  put,
} from "@workagent/ui";
import type { AgentSummary, ChannelAccount } from "../lib/types.js";
import type { ChannelType } from "@workagent/contracts";

type ChannelRow = ChannelAccount & { hasSecret?: boolean; updatedAt: string };

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const [binding, setBinding] = useState({
    accountId: "",
    userId: "",
    externalUserId: "",
  });
  const members = useQuery({
    queryKey: ["channel-members"],
    queryFn: () =>
      get<{ items: { userId: string; name: string; email: string }[] }>(
        "/v1/members",
      ),
  });
  const bind = useMutation({
    mutationFn: () =>
      put(`/v1/channels/${binding.accountId}/bindings`, {
        userId: binding.userId,
        externalUserId: binding.externalUserId,
      }),
    onSuccess: () => setBinding({ ...binding, externalUserId: "" }),
  });
  const [open, setOpen] = useState(false);
  const [testTarget, setTestTarget] = useState<ChannelRow | null>(null);
  const [form, setForm] = useState({
    type: "feishu" as ChannelType,
    name: "",
    appId: "",
    appSecret: "",
    verificationToken: "",
    encryptKey: "",
    defaultAgentId: "",
  });
  const [test, setTest] = useState({
    externalConversationId: "oc_demo_chat",
    externalUserId: "ou_demo_user",
    text: "WorkAgent 渠道测试消息",
  });

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: () => get<{ items: ChannelRow[] }>("/v1/channels"),
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      get<{ items: AgentSummary[] }>("/v1/agents?scope=enterprise"),
  });

  const createChannel = useMutation({
    mutationFn: () =>
      post<{ channel: ChannelRow }>("/v1/channels", {
        ...form,
        defaultAgentId: form.defaultAgentId || undefined,
      }),
    onSuccess: () => {
      setOpen(false);
      setForm({
        type: "feishu",
        name: "",
        appId: "",
        appSecret: "",
        verificationToken: "",
        encryptKey: "",
        defaultAgentId: "",
      });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: (channel: ChannelRow) =>
      patch(`/v1/channels/${channel.id}`, {
        status: channel.status === "active" ? "disabled" : "active",
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });

  const sendTest = useMutation({
    mutationFn: () => post(`/v1/channels/${testTarget?.id}/test`, test),
    onSuccess: () => setTestTarget(null),
  });

  const agentNames = new Map(
    (agents.data?.items ?? []).map((agent) => [agent.id, agent.name]),
  );

  return (
    <div>
      <PageHeader
        title="渠道"
        description="把 Agent 接到飞书、钉钉等 IM，让员工在群里直接使用。"
        actions={<Button onClick={() => setOpen(true)}>新增渠道</Button>}
      />

      <ErrorText error={channels.error ?? agents.error ?? toggleStatus.error} />
      <ol className="wa-steps">
        <li>
          01 · 创建渠道<small>选择飞书或钉钉，命名企业应用。</small>
        </li>
        <li>
          02 · 配置应用
          <small>
            录入真实应用凭证和签名参数，在厂商后台配置事件回调。未提供真实凭证时无法连通。
          </small>
        </li>
        <li>
          03 · 绑定身份
          <small>将准确的 IM 用户 ID 绑定到已存在的企业成员。</small>
        </li>
        <li>
          04 · 开始使用
          <small>在 IM 发起工作，在员工门户继续审批、任务和产物。</small>
        </li>
      </ol>
      <p className="mb-5 text-sm text-slate-500">
        启用只控制本地接入策略；凭证已保存不代表连接成功。网页账号不会自动绑定
        IM 身份。回调必须通过现有签名与时间戳校验。
      </p>
      <Card padding={false}>
        {channels.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={channels.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有渠道账号"
            columns={[
              {
                key: "name",
                header: "名称",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {row.type === "mock" ? "本地模拟 · 非 IM" : row.type}
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
                key: "agent",
                header: "默认 Agent",
                render: (row) =>
                  row.defaultAgentId
                    ? (agentNames.get(row.defaultAgentId) ?? "-")
                    : "未绑定",
              },
              {
                key: "secret",
                header: "凭证",
                render: (row) => (
                  <Badge tone={row.hasSecret ? "green" : "slate"}>
                    {row.hasSecret ? "已配置" : "未配置"}
                  </Badge>
                ),
              },
              {
                key: "created",
                header: "创建时间",
                render: (row) => formatDate(row.createdAt),
              },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        setTestTarget(row);
                        setTest({
                          externalConversationId:
                            row.type === "mock" ? "mock-chat" : "oc_demo_chat",
                          externalUserId:
                            row.type === "mock" ? "mock-user" : "ou_demo_user",
                          text: "WorkAgent 渠道测试消息",
                        });
                      }}
                    >
                      测试
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:underline"
                      onClick={() => toggleStatus.mutate(row)}
                    >
                      {row.status === "active" ? "停用" : "启用"}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <details className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm text-slate-600">
          开发联调说明（模拟渠道，不是 IM 接入）
        </summary>
        <p className="mt-3 text-sm text-slate-500">
          模拟渠道仅供测试环境，不能用于企业
          IM。真实使用请选择飞书或钉钉并配置签名与身份绑定。
        </p>
      </details>

      <Card
        className="mt-6"
        title="绑定员工 IM 身份"
        description="管理员核对外部用户 ID 后保存。此操作不会创建 IM 账号，也不会授予项目权限。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            bind.mutate();
          }}
        >
          <Field label="渠道">
            <Select
              required
              value={binding.accountId}
              onChange={(e) =>
                setBinding({ ...binding, accountId: e.target.value })
              }
            >
              <option value="">选择渠道</option>
              {channels.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="企业成员">
            <Select
              required
              value={binding.userId}
              onChange={(e) =>
                setBinding({ ...binding, userId: e.target.value })
              }
            >
              <option value="">选择成员</option>
              {members.data?.items.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} · {m.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="真实 IM 用户 ID">
            <Input
              required
              value={binding.externalUserId}
              onChange={(e) =>
                setBinding({ ...binding, externalUserId: e.target.value })
              }
            />
          </Field>
          <Button loading={bind.isPending} type="submit">
            保存身份绑定
          </Button>
          <ErrorText error={bind.error ?? members.error} />
          {bind.isSuccess && (
            <p role="status" className="text-sm text-slate-600">
              绑定已保存；未验证消息连通。
            </p>
          )}
        </form>
      </Card>
      <Modal
        open={open}
        title="新增渠道"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={createChannel.isPending}
              disabled={!form.name.trim()}
              onClick={() => createChannel.mutate()}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="类型">
              <Select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as ChannelType })
                }
              >
                <option value="feishu">飞书</option>
                <option value="dingtalk">钉钉</option>
                <option value="mock">Mock</option>
              </Select>
            </Field>
            <Field label="名称">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="默认 Agent">
            <Select
              value={form.defaultAgentId}
              onChange={(event) =>
                setForm({ ...form, defaultAgentId: event.target.value })
              }
            >
              <option value="">不绑定</option>
              {agents.data?.items.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
          </Field>
          {form.type !== "mock" ? (
            <>
              <Field label="App ID">
                <Input
                  value={form.appId}
                  onChange={(event) =>
                    setForm({ ...form, appId: event.target.value })
                  }
                />
              </Field>
              <Field label="App Secret">
                <Input
                  type="password"
                  value={form.appSecret}
                  onChange={(event) =>
                    setForm({ ...form, appSecret: event.target.value })
                  }
                />
              </Field>
              <Field label="Verification Token">
                <Input
                  value={form.verificationToken}
                  onChange={(event) =>
                    setForm({ ...form, verificationToken: event.target.value })
                  }
                />
              </Field>
              <Field label="Encrypt Key">
                <Input
                  type="password"
                  value={form.encryptKey}
                  onChange={(event) =>
                    setForm({ ...form, encryptKey: event.target.value })
                  }
                />
              </Field>
            </>
          ) : null}
          <ErrorText error={createChannel.error} />
        </div>
      </Modal>

      <Modal
        open={Boolean(testTarget)}
        title="发送测试消息"
        description={
          testTarget ? `${testTarget.name} · ${testTarget.type}` : ""
        }
        onClose={() => setTestTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTestTarget(null)}>
              取消
            </Button>
            <Button
              loading={sendTest.isPending}
              onClick={() => sendTest.mutate()}
            >
              发送
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="外部会话 ID">
            <Input
              value={test.externalConversationId}
              onChange={(event) =>
                setTest({ ...test, externalConversationId: event.target.value })
              }
            />
          </Field>
          <Field label="外部用户 ID">
            <Input
              value={test.externalUserId}
              onChange={(event) =>
                setTest({ ...test, externalUserId: event.target.value })
              }
            />
          </Field>
          <Field label="消息">
            <Input
              value={test.text}
              onChange={(event) =>
                setTest({ ...test, text: event.target.value })
              }
            />
          </Field>
          <ErrorText error={sendTest.error} />
        </div>
      </Modal>
    </div>
  );
}
