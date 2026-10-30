import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CopyButton,
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
} from "@workagent/ui";
import type { Member } from "../lib/types.js";

const roles = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "builder", label: "Builder" },
  { value: "operator", label: "Operator" },
  { value: "user", label: "User" },
  { value: "auditor", label: "Auditor" },
];

export function MembersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [password, setPassword] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => get<{ items: Member[] }>("/v1/members"),
  });

  const invite = useMutation({
    mutationFn: () =>
      post<{ member: Member; temporaryPassword?: string }>("/v1/members", {
        email,
        name,
        role,
        password: password || undefined,
      }),
    onSuccess: (data) => {
      setOpen(false);
      setEmail("");
      setName("");
      setPassword("");
      setTemporaryPassword(data.temporaryPassword ?? null);
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, patchBody }: { id: string; patchBody: Record<string, unknown> }) =>
      patch(`/v1/members/${id}`, patchBody),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["members"] }),
  });

  return (
    <div>
      <PageHeader
        title="成员"
        description="按角色分配构建、运营、使用和审计权限。"
        actions={<Button onClick={() => setOpen(true)}>邀请成员</Button>}
      />

      <Card padding={false}>
        {members.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={members.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有成员"
            columns={[
              {
                key: "user",
                header: "成员",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="text-xs text-slate-400">{row.email}</p>
                  </div>
                ),
              },
              {
                key: "role",
                header: "角色",
                render: (row) => (
                  <Select
                    className="w-28"
                    value={row.role}
                    onChange={(event) =>
                      update.mutate({ id: row.id, patchBody: { role: event.target.value } })
                    }
                  >
                    {roles.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                ),
              },
              {
                key: "status",
                header: "状态",
                render: (row) => (
                  <button
                    type="button"
                    onClick={() =>
                      update.mutate({
                        id: row.id,
                        patchBody: { status: row.status === "active" ? "disabled" : "active" },
                      })
                    }
                  >
                    <StatusBadge status={row.status} />
                  </button>
                ),
              },
              { key: "created", header: "加入时间", render: (row) => formatDate(row.createdAt) },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title="邀请成员"
        description="未设置密码时自动生成临时密码。"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={invite.isPending}
              disabled={!email.trim() || !name.trim()}
              onClick={() => invite.mutate()}
            >
              发送邀请
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="邮箱">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="姓名">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="角色">
            <Select value={role} onChange={(event) => setRole(event.target.value)}>
              {roles.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="初始密码" hint="留空自动生成">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <ErrorText error={invite.error} />
        </div>
      </Modal>

      <Modal
        open={Boolean(temporaryPassword)}
        title="成员已创建"
        description="请把临时密码安全地转交给对方。"
        onClose={() => setTemporaryPassword(null)}
        footer={<Button onClick={() => setTemporaryPassword(null)}>知道了</Button>}
      >
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <code className="text-sm text-slate-800">{temporaryPassword}</code>
          <CopyButton value={temporaryPassword ?? ""} />
        </div>
      </Modal>
    </div>
  );
}
