import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Plus, Rocket, Save } from "lucide-react";
import { Button, Card, ErrorText, Field, Input, PageHeader, Select, Spinner, Textarea, get, post, put, useAuth } from "@workagent/ui";
import type { AgentDefinition, AgentSummary, Skill, KnowledgeSpace } from "@workagent/contracts";

type AgentDetail = { agent: AgentSummary; draft: { id: string; version: number; definition: AgentDefinition; changelog: string } | null; published: { id: string; version: number; definition: AgentDefinition } | null; revisions: { id: string; version: number; status: string; changelog: string; createdAt: string; publishedAt: string | null }[] };
type AgentsResponse = { items: AgentSummary[]; total: number };
type CreateAgentResponse = { agent: AgentSummary; draft: { version: number; definition: AgentDefinition } | null; published: null; revisions: AgentDetail["revisions"] };
const blankDefinition = (): AgentDefinition => ({ name: "", description: "", instructions: "", model: { provider: "openai-compatible", model: "gpt-4o-mini", temperature: 0.2, maxOutputTokens: 2048 }, limits: { maxTurns: 12, timeoutMs: 300000, maxToolCalls: 20, maxCostUsd: 1 }, knowledge: [], tools: { skillIds: [], connectorIds: [] }, approval: { mode: "high_risk", highRiskActions: ["write", "delete", "send", "pay"] }, memory: { enabled: false, mode: "user" }, output: { format: "markdown" }, visibility: "org" });

export function AgentsWorkspace() {
  const { agentId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [definition, setDefinition] = useState<AgentDefinition>(blankDefinition);
  const [changelog, setChangelog] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewResult, setPreviewResult] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["admin-agents", user?.orgId], queryFn: () => get<AgentsResponse>("/v1/agents?scope=enterprise"), enabled: !!user?.orgId });
  const detail = useQuery({ queryKey: ["admin-agent", agentId], queryFn: () => get<AgentDetail>(`/v1/agents/${encodeURIComponent(agentId!)}`), enabled: !!agentId });
  const skills = useQuery({ queryKey: ["admin-skills", user?.orgId], queryFn: () => get<{ items: Skill[] }>("/v1/skills"), enabled: !!user?.orgId });
  const knowledge = useQuery({ queryKey: ["admin-knowledge", user?.orgId], queryFn: () => get<{ items: KnowledgeSpace[] }>("/v1/knowledge-spaces"), enabled: !!user?.orgId });
  const current = detail.data?.draft?.definition ?? detail.data?.published?.definition;
  useEffect(() => {
    if (!agentId || !detail.data) {
      setLoadedRevision(null);
      return;
    }
    const revision = detail.data.draft?.id ?? detail.data.published?.id ?? "empty";
    if (revision !== loadedRevision) {
      setDefinition(current ?? blankDefinition());
      setLoadedRevision(revision);
    }
  }, [agentId, current, detail.data, loadedRevision]);
  const form = definition;
  const set = <K extends keyof AgentDefinition>(key: K, value: AgentDefinition[K]) => setDefinition((old) => ({ ...old, [key]: value }));
  const mutation = useMutation<AgentDetail | CreateAgentResponse | unknown, Error, "create" | "save" | "publish" | "preview">({ mutationFn: async (action) => {
    if (action === "create") return post<CreateAgentResponse>("/v1/agents", { definition });
    if (!agentId) throw new Error("先创建 Agent 草稿");
    if (action === "save") return put<AgentDetail>(`/v1/agents/${agentId}`, { definition, changelog });
    if (action === "publish") return post<AgentDetail>(`/v1/agents/${agentId}/publish`, { changelog });
    return post(`/v1/agents/${agentId}/preview`, { message: previewText });
  }, onSuccess: async (result, action) => {
    if (action === "create") {
      const created = result as CreateAgentResponse;
      setCreating(false);
      setDefinition(created.draft?.definition ?? blankDefinition());
      cache.setQueryData(["admin-agent", created.agent.id], created);
      navigate(`/tenant/agents/${created.agent.id}`);
    }
    if (action === "preview") setPreviewResult(result);
    else setMessage(action === "publish" ? "已发布新版本。" : "草稿已保存。");
    await cache.invalidateQueries({ queryKey: ["admin-agents"] });
    if (action !== "create") await cache.invalidateQueries({ queryKey: ["admin-agent", agentId] });
  } });
  const onCreate = (event: FormEvent) => { event.preventDefault(); mutation.mutate("create"); };
  const toggleId = (items: string[], id: string) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
  if (list.isLoading && !agentId) return <Spinner />;
  if (!agentId) return <div className="space-y-5"><PageHeader title="智能体" description="构建企业 Agent 的指令、模型、知识和技能依赖，并通过草稿预览后发布。" actions={<Button onClick={() => { setDefinition(blankDefinition()); setCreating(true); }}><Plus size={16} />新建 Agent</Button>} /><ErrorText error={list.error} />{list.data?.items.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.data.items.map((agent) => <Link key={agent.id} to={`/tenant/agents/${agent.id}`} className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-500"><div className="flex justify-between gap-3"><h2 className="font-semibold">{agent.name}</h2><span className="text-xs text-slate-500">{agent.status}</span></div><p className="mt-2 line-clamp-2 text-sm text-slate-600">{agent.description || "暂无说明"}</p><p className="mt-4 text-xs text-slate-500">{agent.publishedVersion ? `已发布 v${agent.publishedVersion}` : "尚未发布"} · {agent.visibility === "org" ? "企业可见" : agent.visibility}</p></Link>)}</div> : <Card title="还没有企业 Agent" description="创建草稿后可配置完整指令、能力依赖和发布版本。"><Button onClick={() => setCreating(true)}><Plus size={16} />创建第一个 Agent</Button></Card>}
    {creating ? <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-3 sm:p-8"><section role="dialog" aria-modal="true" className="mx-auto my-4 max-w-4xl rounded-lg bg-white shadow-xl"><div className="border-b px-6 py-4"><h2 className="text-lg font-semibold">创建 Agent 草稿</h2><p className="mt-1 text-sm text-slate-500">保存后进入版本化编辑器，再预览和发布。</p></div><form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={onCreate}><Field label="名称"><Input required maxLength={100} value={definition.name} onChange={(e) => set("name", e.target.value)} /></Field><Field label="可见范围"><Select value={definition.visibility} onChange={(e) => set("visibility", e.target.value as AgentDefinition["visibility"])}><option value="org">企业</option><option value="private">仅创建者</option><option value="public">公开</option></Select></Field><Field label="说明" className="sm:col-span-2"><Textarea maxLength={2000} rows={2} value={definition.description} onChange={(e) => set("description", e.target.value)} /></Field><Field label="系统指令" hint="描述职责、工作步骤、边界和输出要求。" className="sm:col-span-2"><Textarea required maxLength={20000} rows={8} value={definition.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field><div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setCreating(false)}>取消</Button><Button loading={mutation.isPending} type="submit"><Save size={15} />保存草稿并继续</Button></div><div className="sm:col-span-2"><ErrorText error={mutation.error} /></div></form></section></div> : null}
  </div>;

  if (detail.isLoading) return <Spinner />;
  if (!detail.data) return <div className="space-y-4"><PageHeader title="无法载入 Agent" /><ErrorText error={detail.error} /><Button variant="outline" onClick={() => void detail.refetch()}>重试</Button></div>;
  return <div className="space-y-5"><Link to="/tenant/agents" className="inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft size={15} />返回 Agent 列表</Link><PageHeader title={detail.data.agent.name} description={`版本 ${detail.data.draft ? `v${detail.data.draft.version} 草稿` : `v${detail.data.published?.version ?? 0} 已发布`} · ${detail.data.agent.status}`} actions={<><Button variant="outline" disabled={mutation.isPending || !detail.data.draft} onClick={() => { if (!previewText) setPreviewText("请根据系统指令，给出一个简短的工作示例。"); setPreviewResult(null); }}><Eye size={15} />测试预览</Button><Button variant="outline" loading={mutation.isPending} onClick={() => mutation.mutate("save")}><Save size={15} />保存草稿</Button><Button loading={mutation.isPending || !detail.data.draft} onClick={() => mutation.mutate("publish")}><Rocket size={15} />发布版本</Button></>} /><ErrorText error={list.error ?? skills.error ?? knowledge.error ?? mutation.error} />{message ? <p role="status" className="border-l-2 border-emerald-700 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p> : null}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"><div className="space-y-5"><Card title="基础信息"><div className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field><Field label="可见范围"><Select value={form.visibility} onChange={(e) => set("visibility", e.target.value as AgentDefinition["visibility"])}><option value="org">企业</option><option value="private">仅创建者</option><option value="public">公开</option></Select></Field><Field label="说明" className="sm:col-span-2"><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field><Field label="系统指令" className="sm:col-span-2"><Textarea rows={9} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field><Field label="变更说明" className="sm:col-span-2"><Input maxLength={500} value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="本版本变更内容" /></Field></div></Card>
      <Card title="模型与输出"><div className="grid gap-4 sm:grid-cols-2"><Field label="模型标识"><Input value={form.model.model} onChange={(e) => set("model", { ...form.model, model: e.target.value })} /></Field><Field label="温度"><Input type="number" min="0" max="2" step="0.1" value={form.model.temperature} onChange={(e) => set("model", { ...form.model, temperature: Number(e.target.value) })} /></Field><Field label="最大输出 Token"><Input type="number" min="64" max="32000" value={form.model.maxOutputTokens} onChange={(e) => set("model", { ...form.model, maxOutputTokens: Number(e.target.value) })} /></Field><Field label="输出格式"><Select value={form.output.format} onChange={(e) => set("output", { ...form.output, format: e.target.value as AgentDefinition["output"]["format"] })}><option value="markdown">Markdown</option><option value="text">纯文本</option><option value="json">JSON</option></Select></Field></div></Card>
      <Card title="执行策略"><div className="grid gap-4 sm:grid-cols-2"><Field label="最大轮次"><Input type="number" min="1" max="50" value={form.limits.maxTurns} onChange={(e) => set("limits", { ...form.limits, maxTurns: Number(e.target.value) })} /></Field><Field label="超时毫秒"><Input type="number" min="1000" value={form.limits.timeoutMs} onChange={(e) => set("limits", { ...form.limits, timeoutMs: Number(e.target.value) })} /></Field><Field label="最大工具调用"><Input type="number" min="1" max="100" value={form.limits.maxToolCalls} onChange={(e) => set("limits", { ...form.limits, maxToolCalls: Number(e.target.value) })} /></Field><Field label="审批策略"><Select value={form.approval.mode} onChange={(e) => set("approval", { ...form.approval, mode: e.target.value as AgentDefinition["approval"]["mode"] })}><option value="always">每次审批</option><option value="high_risk">高风险操作审批</option><option value="never">不要求审批</option></Select></Field></div></Card>
      <Card title="技能依赖"><div className="space-y-2">{skills.data?.items.map((skill) => <label key={skill.id} className="flex items-start gap-3 border-b border-slate-100 py-2 text-sm"><input type="checkbox" checked={form.tools.skillIds.includes(skill.id)} onChange={() => set("tools", { ...form.tools, skillIds: toggleId(form.tools.skillIds, skill.id) })} /><span><strong>{skill.name}</strong><small className="block text-slate-500">{skill.description}</small></span></label>)}{!skills.data?.items.length ? <p className="text-sm text-slate-500">暂无技能，请先创建技能资产。</p> : null}</div></Card>
      <Card title="知识空间"><div className="space-y-2">{knowledge.data?.items.map((space) => { const selected = form.knowledge.some((item) => item.spaceId === space.id); return <div key={space.id} className="grid items-center gap-3 border-b border-slate-100 py-2 sm:grid-cols-[minmax(0,1fr)_100px_120px]"><label className="flex gap-3 text-sm"><input type="checkbox" checked={selected} onChange={() => set("knowledge", selected ? form.knowledge.filter((item) => item.spaceId !== space.id) : [...form.knowledge, { spaceId: space.id, topK: 5, minScore: 0.2 }])} /><span>{space.name}<small className="block text-slate-500">{space.documentCount} 篇文档</small></span></label>{selected ? <Field label="Top K"><Input type="number" min="1" max="20" value={form.knowledge.find((item) => item.spaceId === space.id)?.topK ?? 5} onChange={(e) => set("knowledge", form.knowledge.map((item) => item.spaceId === space.id ? { ...item, topK: Number(e.target.value) } : item))} /></Field> : null}</div>; })}{!knowledge.data?.items.length ? <p className="text-sm text-slate-500">暂无知识空间。</p> : null}</div></Card>
      </div><aside className="space-y-4"><Card title="版本历史"><div className="divide-y">{detail.data.revisions.map((revision) => <div key={revision.id} className="py-3"><p className="text-sm font-medium">v{revision.version} · {revision.status}</p><p className="mt-1 text-xs text-slate-500">{revision.changelog || "无变更说明"}</p><time className="mt-1 block text-xs text-slate-400">{new Date(revision.createdAt).toLocaleString("zh-CN")}</time></div>)}</div></Card><Card title="预览测试"><Field label="测试输入"><Textarea rows={4} value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="输入一个示例任务" /></Field><Button className="mt-3" disabled={!detail.data.draft || !previewText} loading={mutation.isPending} onClick={() => mutation.mutate("preview")}>运行预览</Button>{previewResult ? <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap bg-slate-50 p-3 text-xs">{JSON.stringify(previewResult, null, 2)}</pre> : null}</Card></aside></div>
  </div>;
}
