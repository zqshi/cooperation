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
  Spinner,
  Textarea,
  formatDate,
  get,
  post,
} from "@workagent/ui";
import type { KnowledgeSpace } from "../lib/types.js";

export function KnowledgePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const spaces = useQuery({
    queryKey: ["knowledge-spaces"],
    queryFn: () => get<{ items: KnowledgeSpace[] }>("/v1/knowledge-spaces"),
  });

  const createSpace = useMutation({
    mutationFn: () => post<{ space: KnowledgeSpace }>("/v1/knowledge-spaces", { name, description }),
    onSuccess: (data) => {
      setOpen(false);
      setName("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["knowledge-spaces"] });
      navigate(`/tenant/knowledge/${data.space.id}`);
    },
  });

  return (
    <div>
      <PageHeader
        title="知识库"
        description="上传文档，自动切分并向量化，运行时按语义检索。"
        actions={<Button onClick={() => setOpen(true)}>新建知识库</Button>}
      />

      <Card padding={false}>
        {spaces.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={spaces.data?.items ?? []}
            keyFor={(row) => row.id}
            empty="还没有知识库"
            onRowClick={(row) => navigate(`/tenant/knowledge/${row.id}`)}
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
              { key: "documents", header: "文档", render: (row) => `${row.documentCount} 个` },
              { key: "model", header: "嵌入模型", render: (row) => row.embeddingModel },
              { key: "updated", header: "更新时间", render: (row) => formatDate(row.updatedAt) },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title="新建知识库"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              loading={createSpace.isPending}
              disabled={!name.trim()}
              onClick={() => createSpace.mutate()}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="描述">
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <ErrorText error={createSpace.error} />
        </div>
      </Modal>
    </div>
  );
}
