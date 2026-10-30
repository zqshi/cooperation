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
  del,
} from "@workagent/ui";
import type { Skill } from "../lib/types.js";

type FormState = {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  visibility: string;
};

const empty: FormState = { name: "", description: "", instructions: "", visibility: "org" };

export function SkillsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmDelete, setConfirmDelete] = useState<Skill | null>(null);

  const skills = useQuery({
    queryKey: ["skills"],
    queryFn: () => get<{ items: Skill[] }>("/v1/skills"),
  });

  const save = useMutation({
    mutationFn: () =>
      form.id
        ? patch<{ skill: Skill }>(`/v1/skills/${form.id}`, {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            visibility: form.visibility,
          })
        : post<{ skill: Skill }>("/v1/skills", form),
    onSuccess: () => {
      setOpen(false);
      setForm(empty);
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => del(`/v1/skills/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  const openEdit = (skill: Skill) => {
    setForm({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      visibility: skill.visibility,
    });
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Skill"
        description="可复用的提示词包：把方法论、话术和输出规范沉淀下来。"
        actions={
          <Button
            onClick={() => {
              setForm(empty);
              setOpen(true);
            }}
          >
            新建 Skill
          </Button>
        }
      />

      <Card padding={false}>
        {skills.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={skills.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有 Skill"
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
              { key: "version", header: "版本", render: (row) => <Badge>v{row.version}</Badge> },
              { key: "visibility", header: "可见性", render: (row) => row.visibility },
              { key: "updated", header: "更新时间", render: (row) => formatDate(row.updatedAt) },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmDelete(row);
                    }}
                  >
                    归档
                  </button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title={form.id ? "编辑 Skill" : "新建 Skill"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form.name.trim() || !form.instructions.trim()}
              onClick={() => save.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
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
          <Field label="指令">
            <Textarea
              rows={10}
              value={form.instructions}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
            />
          </Field>
          <Field label="可见性">
            <Select
              value={form.visibility}
              onChange={(event) => setForm({ ...form, visibility: event.target.value })}
            >
              <option value="private">仅自己</option>
              <option value="org">组织内</option>
              <option value="public">公开</option>
            </Select>
          </Field>
          <ErrorText error={save.error} />
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        title="归档 Skill"
        description={`归档后不可在 Agent 中选择：${confirmDelete?.name ?? ""}`}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={archive.isPending}
              onClick={() => confirmDelete && archive.mutate(confirmDelete.id)}
            >
              确认归档
            </Button>
          </>
        }
      >
        <ErrorText error={archive.error} />
      </Modal>
    </div>
  );
}
