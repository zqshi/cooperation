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
  Textarea,
  formatDate,
  get,
  patch,
  post,
} from "@workagent/ui";
import type { Connector, ConnectorTool } from "@workagent/contracts";
import type { Connector as ConnectorType } from "../lib/types.js";

type FormState = {
  id?: string;
  name: string;
  description: string;
  type: "http" | "mcp";
  baseUrl: string;
  mcpUrl: string;
  authType: "none" | "bearer" | "api_key" | "basic";
  secret: string;
  toolsText: string;
};

const exampleTools = [
  {
    name: "lookup_order",
    description: "根据订单号查询订单状态与物流信息",
    method: "POST",
    path: "/mock/tools/lookup_order",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string", description: "订单号" } },
      required: ["orderId"],
    },
    risk: "low",
    approvalRequired: false,
  },
];

const empty: FormState = {
  name: "",
  description: "",
  type: "http",
  baseUrl: "",
  mcpUrl: "",
  authType: "none",
  secret: "",
  toolsText: JSON.stringify(exampleTools, null, 2),
};

export function ConnectorsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [jsonError, setJsonError] = useState("");

  const connectors = useQuery({
    queryKey: ["connectors"],
    queryFn: () => get<{ items: ConnectorType[] }>("/v1/connectors"),
  });

  const save = useMutation({
    mutationFn: () => {
      let tools: ConnectorTool[];
      try {
        tools = JSON.parse(form.toolsText);
        setJsonError("");
      } catch {
        setJsonError("工具定义不是合法 JSON");
        throw new Error("工具定义不是合法 JSON");
      }
      const payload = {
        name: form.name,
        description: form.description,
        type: form.type,
        baseUrl: form.type === "http" ? form.baseUrl : undefined,
        mcpUrl: form.type === "mcp" ? form.mcpUrl : undefined,
        authType: form.authType,
        secret: form.secret || undefined,
        tools,
      };
      return form.id
        ? patch<{ connector: Connector }>(`/v1/connectors/${form.id}`, payload)
        : post<{ connector: Connector }>("/v1/connectors", payload);
    },
    onSuccess: () => {
      setOpen(false);
      setForm(empty);
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    },
  });

  const openEdit = (connector: ConnectorType) => {
    setForm({
      id: connector.id,
      name: connector.name,
      description: connector.description,
      type: connector.type,
      baseUrl: connector.baseUrl ?? "",
      mcpUrl: connector.mcpUrl ?? "",
      authType: connector.authType,
      secret: "",
      toolsText: JSON.stringify(connector.tools, null, 2),
    });
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Connector"
        description="把内部 API 或 MCP 服务包装成 Agent 可调用的工具。"
        actions={
          <Button
            onClick={() => {
              setForm(empty);
              setOpen(true);
            }}
          >
            新建 Connector
          </Button>
        }
      />

      <Card padding={false}>
        {connectors.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={connectors.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有 Connector"
            onRowClick={openEdit}
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
              { key: "type", header: "类型", render: (row) => <Badge>{row.type.toUpperCase()}</Badge> },
              {
                key: "url",
                header: "地址",
                render: (row) => (
                  <span className="line-clamp-1 max-w-xs text-xs text-slate-500">
                    {row.baseUrl ?? row.mcpUrl ?? "-"}
                  </span>
                ),
              },
              { key: "tools", header: "工具", render: (row) => `${row.tools.length} 个` },
              { key: "updated", header: "更新时间", render: (row) => formatDate(row.updatedAt) },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title={form.id ? "编辑 Connector" : "新建 Connector"}
        description="工具名必须是小写字母开头、只含小写字母/数字/下划线。"
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form.name.trim()}
              onClick={() => save.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名称">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="描述">
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
            <Field label="类型">
              <Select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as "http" | "mcp" })
                }
              >
                <option value="http">HTTP</option>
                <option value="mcp">MCP</option>
              </Select>
            </Field>
            <Field label="认证方式">
              <Select
                value={form.authType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    authType: event.target.value as FormState["authType"],
                  })
                }
              >
                <option value="none">无</option>
                <option value="bearer">Bearer Token</option>
                <option value="api_key">API Key</option>
                <option value="basic">Basic</option>
              </Select>
            </Field>
            {form.type === "http" ? (
              <Field label="Base URL" className="sm:col-span-2">
                <Input
                  value={form.baseUrl}
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                  placeholder="https://api.example.com"
                />
              </Field>
            ) : (
              <Field label="MCP URL" className="sm:col-span-2">
                <Input
                  value={form.mcpUrl}
                  onChange={(event) => setForm({ ...form, mcpUrl: event.target.value })}
                  placeholder="https://mcp.example.com/sse"
                />
              </Field>
            )}
            <Field
              label="密钥"
              hint={form.id ? "留空表示不修改" : "将加密存储"}
              className="sm:col-span-2"
            >
              <Input
                type="password"
                value={form.secret}
                onChange={(event) => setForm({ ...form, secret: event.target.value })}
              />
            </Field>
          </div>
          <Field label="工具定义（JSON）" error={jsonError}>
            <Textarea
              rows={16}
              className="font-mono text-xs"
              value={form.toolsText}
              onChange={(event) => setForm({ ...form, toolsText: event.target.value })}
            />
          </Field>
          <ErrorText error={save.error} />
        </div>
      </Modal>
    </div>
  );
}
