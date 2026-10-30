import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusBadge,
  formatDate,
  get,
  post,
  del,
  uploadFile,
} from "@workagent/ui";
import type { Document, KnowledgeSpace } from "../lib/types.js";

type Chunk = {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  score: number;
};

export function KnowledgeDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [chunks, setChunks] = useState<Chunk[]>([]);

  const space = useQuery({
    queryKey: ["knowledge-space", id],
    queryFn: () => get<{ space: KnowledgeSpace }>(`/v1/knowledge-spaces/${id}`),
    enabled: Boolean(id),
  });
  const documents = useQuery({
    queryKey: ["documents", id],
    queryFn: () => get<{ items: Document[] }>(`/v1/knowledge-spaces/${id}/documents`),
    enabled: Boolean(id),
    refetchInterval: 3000,
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadFile<{ document: Document }>(`/v1/knowledge-spaces/${id}/documents`, file),
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["documents", id] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-spaces"] });
    },
  });

  const reindex = useMutation({
    mutationFn: (documentId: string) => post(`/v1/documents/${documentId}/reindex`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["documents", id] }),
  });

  const remove = useMutation({
    mutationFn: (documentId: string) => del(`/v1/documents/${documentId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["documents", id] }),
  });

  const search = useMutation({
    mutationFn: () =>
      post<{ chunks: Chunk[] }>(`/v1/knowledge-spaces/${id}/search`, { query, topK: 5 }),
    onSuccess: (data) => setChunks(data.chunks),
  });

  if (space.isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link to="/tenant/knowledge" className="text-slate-400 hover:text-slate-600">
              知识库
            </Link>
            <span className="text-slate-300">/</span>
            {space.data?.space.name ?? ""}
          </span>
        }
        description={space.data?.space.description}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            <Button loading={upload.isPending} onClick={() => fileRef.current?.click()}>
              上传文档
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="文档" className="lg:col-span-2" padding={false}>
          {documents.isLoading ? (
            <Spinner />
          ) : (
            <DataTable
              rows={documents.data?.items ?? []}
              keyFor={(row) => row.id}
              empty="还没有文档，先上传一份 PDF 或 Markdown"
              columns={[
                {
                  key: "name",
                  header: "文件",
                  render: (row) => (
                    <div>
                      <p className="font-medium text-slate-800">{row.name}</p>
                      <p className="text-xs text-slate-400">
                        {(row.size / 1024).toFixed(1)} KB · {row.chunkCount} 个片段
                      </p>
                      {row.error ? <p className="text-xs text-red-600">{row.error}</p> : null}
                    </div>
                  ),
                },
                { key: "status", header: "状态", render: (row) => <StatusBadge status={row.status} /> },
                { key: "created", header: "上传时间", render: (row) => formatDate(row.createdAt) },
                {
                  key: "actions",
                  header: "",
                  render: (row) => (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => reindex.mutate(row.id)}
                      >
                        重索引
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => remove.mutate(row.id)}
                      >
                        删除
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          )}
          <div className="border-t border-slate-100 px-5 py-3">
            <ErrorText error={upload.error ?? reindex.error ?? remove.error} />
            <p className="text-[11px] text-slate-400">
              支持 txt / md / json / csv / html；PDF 与 DOCX 需安装对应解析依赖。
            </p>
          </div>
        </Card>

        <Card title="检索测试" description="验证切分与召回效果。">
          <Field label="查询">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：退货政策"
            />
          </Field>
          <Button
            className="mt-3 w-full"
            loading={search.isPending}
            disabled={!query.trim()}
            onClick={() => search.mutate()}
          >
            检索
          </Button>
          <ErrorText error={search.error} />
          <div className="mt-4 space-y-3">
            {chunks.map((chunk) => (
              <div key={chunk.chunkId} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-xs font-medium text-slate-600">
                    {chunk.documentName}
                  </span>
                  <Badge tone="green">{chunk.score.toFixed(2)}</Badge>
                </div>
                <p className="mt-1 line-clamp-4 text-xs leading-5 text-slate-500">{chunk.content}</p>
              </div>
            ))}
            {search.isSuccess && chunks.length === 0 ? (
              <p className="text-xs text-slate-400">没有命中片段。</p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
