import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Button,
  Card,
  del,
  ErrorText,
  Field,
  get,
  Input,
  PageHeader,
  put,
  Spinner,
  Textarea,
  useAuth,
} from "@workagent/ui";
import type { PersonalState } from "../lib/personal.js";

type Section = "personalSkills" | "knowledgeEntries" | "memoryEntries";
type ContextRow = Record<string, string>;
const sections: Record<Section, { title: string; description: string; fields: { name: string; label: string; placeholder: string; rows?: number }[]; blank: ContextRow }> = {
  personalSkills: {
    title: "个人技能",
    description: "保存常用的文本工作方法；启用内容会进入私人搭档的新版本指令，不会调用外部工具。",
    fields: [{ name: "name", label: "技能名称", placeholder: "例如：会议纪要整理" }, { name: "instruction", label: "工作方法", placeholder: "描述步骤、检查点和输出结构", rows: 5 }],
    blank: { name: "", instruction: "" },
  },
  knowledgeEntries: {
    title: "个人知识",
    description: "添加本人提供的术语、背景和规则；保存后作为私人搭档的上下文。",
    fields: [{ name: "title", label: "条目名称", placeholder: "例如：团队项目术语" }, { name: "content", label: "知识内容", placeholder: "输入需要搭档了解的事实与规则", rows: 5 }],
    blank: { title: "", content: "" },
  },
  memoryEntries: {
    title: "我的记忆",
    description: "由你确认并维护的长期偏好与事实。系统不会自动推断或保存聊天记忆。",
    fields: [{ name: "content", label: "记忆内容", placeholder: "例如：涉及数字时保留来源和计算过程", rows: 3 }],
    blank: { content: "" },
  },
};

export function PortalCapabilityPage({ section }: { section: Section }) {
  const definition = sections[section];
  const { user } = useAuth();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["personal-assistant", user?.orgId, user?.id],
    queryFn: () => get<PersonalState>("/v1/personal-assistant"),
    enabled: !!user,
  });
  const [rows, setRows] = useState<ContextRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<ContextRow>({ ...definition.blank });
  const [saved, setSaved] = useState(false);
  const profile = query.data?.agent?.profile;
  useEffect(() => {
    if (profile) setRows((profile[section] ?? []) as unknown as ContextRow[]);
  }, [profile, section]);
  const mutation = useMutation({
    mutationFn: (nextRows: ContextRow[]) => {
      if (!profile) throw new Error("私人搭档尚未开通");
      return put("/v1/personal-assistant", { ...profile, [section]: nextRows });
    },
    onSuccess: async () => {
      setSaved(true);
      setEditing(null);
      await cache.invalidateQueries({ queryKey: ["personal-assistant"] });
    },
  });
  function updateDraft(name: string, value: string) {
    setSaved(false);
    setDraft((current) => ({ ...current, [name]: value }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = [...rows];
    if (editing === -1) next.push(draft);
    else if (editing !== null) next[editing] = draft;
    mutation.mutate(next);
  }
  function openEditor(index: number | null) {
    setDraft(index === null ? { ...definition.blank } : { ...rows[index] });
    setEditing(index ?? -1);
    setSaved(false);
  }
  function remove(index: number) {
    mutation.mutate(rows.filter((_row, rowIndex) => rowIndex !== index));
  }
  if (query.isLoading) return <Spinner />;
  return <div className="space-y-5">
    <PageHeader title={definition.title} description={definition.description} actions={<Button onClick={() => openEditor(null)}>新增{section === "personalSkills" ? "技能" : section === "knowledgeEntries" ? "知识" : "记忆"}</Button>} />
    <ErrorText error={query.error ?? mutation.error} />
    {saved ? <p role="status" className="border-l-2 border-emerald-700 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">已保存并生成新的私人指令版本。</p> : null}
    <div className="space-y-3">
      {rows.map((row, index) => <Card key={`${section}-${index}`} title={section === "memoryEntries" ? row.content : row.name ?? row.title} description={section === "personalSkills" ? row.instruction : section === "knowledgeEntries" ? row.content : undefined} actions={<><Button variant="outline" size="sm" disabled={mutation.isPending} onClick={() => openEditor(index)}>编辑</Button><Button variant="ghost" size="sm" disabled={mutation.isPending} aria-label={`删除${definition.title} ${index + 1}`} onClick={() => remove(index)}>删除</Button></>} />)}
      {!rows.length ? <Card title={`还没有${definition.title}`} description="添加内容后，它会按本人授权范围用于私人搭档。"><Button variant="outline" onClick={() => openEditor(null)}>立即添加</Button></Card> : null}
    </div>
    {editing !== null ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section role="dialog" aria-modal="true" aria-labelledby="capability-editor-title" className="w-full max-w-2xl rounded-lg bg-white shadow-xl"><header className="border-b border-slate-200 px-5 py-4"><h2 id="capability-editor-title" className="font-semibold">{editing === -1 ? `新增${definition.title}` : `编辑${definition.title}`}</h2></header><form className="space-y-4 p-5" onSubmit={submit}><ErrorText error={mutation.error} /><div className="grid gap-4 sm:grid-cols-2">{definition.fields.map((field) => <Field key={field.name} label={field.label} className={field.rows ? "sm:col-span-2" : undefined}>{field.rows ? <Textarea rows={field.rows} maxLength={section === "memoryEntries" ? 1000 : 3000} required value={draft[field.name] ?? ""} placeholder={field.placeholder} onChange={(event) => updateDraft(field.name, event.target.value)} /> : <Input maxLength={100} required value={draft[field.name] ?? ""} placeholder={field.placeholder} onChange={(event) => updateDraft(field.name, event.target.value)} />}</Field>)}</div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>取消</Button><Button loading={mutation.isPending} type="submit">保存</Button></div></form></section></div> : null}
  </div>;
}

type GrowthResponse = {
  summary: { revisions: number; runs: number; succeeded: number; failed: number; activeVersion?: number | null };
  items: { id: string; status: string; createdAt: string; finishedAt: string | null; summary: string }[];
};

export function PersonalGrowthPage() {
  const query = useQuery({ queryKey: ["personal-growth"], queryFn: () => get<GrowthResponse>("/v1/personal-growth") });
  const stats = query.data?.summary;
  return <div className="space-y-5"><PageHeader title="搭档成长" description="查看私人指令版本和实际文本执行记录。" /><ErrorText error={query.error} />
    {query.isLoading ? <Spinner /> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["当前版本", stats?.activeVersion ?? "—"], ["指令版本", stats?.revisions ?? 0], ["近 30 天执行", stats?.runs ?? 0], ["成功执行", stats?.succeeded ?? 0]].map(([label, value]) => <Card key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></Card>)}</section>
      <Card title="近期执行"><div className="divide-y">{query.data?.items.map((item) => <div key={item.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium">{item.summary || "文本执行"}</span><span className="text-xs text-slate-500">{item.status}</span></div><time className="mt-1 block text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></div>)}{!query.data?.items.length ? <p className="py-3 text-sm text-slate-500">暂无执行记录。</p> : null}</div></Card>
    </>}</div>;
}

type ContentItem = { id: string; title: string; slug: string; summary: string; publishedAt: string };
export function PortalContentPage() {
  const { id } = useParams();
  const list = useQuery({ queryKey: ["portal-content"], queryFn: () => get<{ items: ContentItem[] }>("/v1/portal-content"), enabled: !id });
  const detail = useQuery({ queryKey: ["portal-content", id], queryFn: () => get<{ item: ContentItem & { body: string } }>(`/v1/portal-content/${encodeURIComponent(id!)}`), enabled: !!id });
  if (id) return <div className="space-y-5"><PageHeader title={detail.data?.item.title ?? "内容详情"} description={detail.data?.item.publishedAt ? new Date(detail.data.item.publishedAt).toLocaleDateString("zh-CN") : undefined} /><ErrorText error={detail.error} />{detail.isLoading ? <Spinner /> : <Card><p className="whitespace-pre-wrap text-sm leading-7">{detail.data?.item.body}</p></Card>}</div>;
  return <div className="space-y-5"><PageHeader title="内容动态" description="企业发布给成员的公告与工作内容。" /><ErrorText error={list.error} />{list.isLoading ? <Spinner /> : list.data?.items.length ? list.data.items.map((item) => <Card key={item.id} title={item.title} description={new Date(item.publishedAt).toLocaleString("zh-CN")}><p className="text-sm leading-6 text-slate-600">{item.summary}</p><Link className="mt-3 inline-block text-sm font-medium text-teal-800" to={`/content/${encodeURIComponent(item.id)}`}>查看内容</Link></Card>) : <Card title="暂无已发布内容" />}</div>;
}

type SessionItem = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string; current: boolean };
export function PortalDevicesPage() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ["portal-sessions"], queryFn: () => get<{ items: SessionItem[] }>("/v1/auth/sessions") });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/v1/auth/sessions/${encodeURIComponent(id)}`), onSuccess: () => cache.invalidateQueries({ queryKey: ["portal-sessions"] }) });
  return <div className="space-y-5"><PageHeader title="登录设备" description="查看并结束本人在此企业账号下的其他登录会话。" /><ErrorText error={query.error ?? revoke.error} />{query.isLoading ? <Spinner /> : query.data?.items.length ? <Card title="有效登录会话"><div className="divide-y">{query.data.items.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium">{session.current ? "当前会话" : session.userAgent || "浏览器会话"}</p><p className="mt-1 text-xs text-slate-500">{session.ipAddress || "IP 未记录"} · 登录于 {new Date(session.createdAt).toLocaleString("zh-CN")}</p></div>{session.current ? <span className="text-xs text-emerald-700">正在使用</span> : <Button variant="outline" size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(session.id)}>结束会话</Button>}</div>)}</div></Card> : <Card title="没有有效登录会话" />}</div>;
}
