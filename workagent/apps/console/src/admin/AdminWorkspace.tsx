import { useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LockKeyhole, ShieldCheck, Activity, Building2, Bot, Server, KeyRound } from "lucide-react";
import { Button, Card, ErrorText, Field, Input, Spinner, useAuth } from "@workagent/ui";
import { AdminLayout } from "./AdminLayout.js";
import { AdminPage } from "./AdminPage.js";
import { AgentsWorkspace } from "./features/AgentsWorkspace.js";
import { SkillsWorkspace } from "./features/SkillsWorkspace.js";
import { ModelsWorkspace } from "./features/ModelsWorkspace.js";
import { KnowledgeWorkspace } from "./features/KnowledgeWorkspace.js";
import { AdminApiError, adminRequest } from "./api.js";
import { platformRoutes, tenantRoutes, type AdminShell } from "./navigation.js";

export function AdminRoutes({ shell }: { shell: AdminShell }) {
  const routes = shell === "platform" ? platformRoutes : tenantRoutes;
  const page = (route: (typeof routes)[number]) => {
    if (route.redirect) return <Navigate to={route.redirect} replace />;
    if (route.pageId === "agents" || route.pageId === "agent-detail") return <AgentsWorkspace />;
    if (route.pageId === "skills") return <SkillsWorkspace />;
    if (route.pageId === "models") return <ModelsWorkspace />;
    if (["knowledge", "knowledge-create", "knowledge-detail", "knowledge-document"].includes(route.pageId ?? "")) return <KnowledgeWorkspace />;
    return route.pageId ? <AdminPage key={route.pageId} pageId={route.pageId} /> : null;
  };
  return <Routes>
    {routes.map((route) => <Route
      key={route.path}
      path={route.path}
      element={page(route)}
    />)}
    <Route path="/" element={<Navigate to={shell === "platform" ? "/" : "/overview"} replace />} />
    <Route path="*" element={<Card title="页面不存在" description="请从左侧导航选择页面。" />} />
  </Routes>;
}

export function TenantWorkspace() {
  const { user, loading, logout } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <TenantAdminLogin />;
  if (!["owner", "admin", "builder", "auditor"].includes(user.role)) return <Card title="无租户管理权限"><Button onClick={() => void logout()}>退出登录</Button></Card>;
  return <AdminLayout shell="tenant" identity={user.email} role={user.role} onLogout={() => void logout()}><AdminRoutes shell="tenant" /></AdminLayout>;
}

function TenantAdminLogin() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(email, password);
      setPassword("");
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen bg-white text-slate-900 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
    <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-slate-200 bg-[#f3f7f5] p-10 lg:flex xl:p-14">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-800 text-white"><Building2 size={20} /></span><div><div className="text-sm font-semibold">WorkAgent</div><div className="text-xs text-slate-500">租户管理后台</div></div></div>
      <div className="relative z-10 max-w-xl">
        <div className="mb-5 inline-flex items-center gap-2 border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800"><ShieldCheck size={14} />企业管理工作区</div>
        <h1 className="max-w-lg text-4xl font-semibold leading-tight text-slate-900">可交付 AI 员工<br />管理后台</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">管理智能体、技能、模型、知识与应用渠道，查看运行情况并维护企业授权。</p>
        <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
          <div className="border border-slate-200 bg-white p-4"><Bot size={17} className="text-teal-800" /><div className="mt-3 text-sm font-medium">智能体与依赖</div><div className="mt-1 text-xs text-slate-500">构建、配置、评测</div></div>
          <div className="border border-slate-200 bg-white p-4"><Activity size={17} className="text-emerald-700" /><div className="mt-3 text-sm font-medium">运行与治理</div><div className="mt-1 text-xs text-slate-500">渠道、观测、审计</div></div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500"><span>WORKAGENT TENANT CONSOLE</span><span>企业工作区</span></div>
    </section>
    <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-800 text-white"><Building2 size={18} /></span><div><div className="text-sm font-semibold">WorkAgent</div><div className="text-xs text-slate-500">租户管理后台</div></div></div>
        <div className="mb-8"><p className="text-xs font-semibold text-teal-800">TENANT ADMINISTRATION</p><h2 className="mt-2 text-2xl font-semibold">登录管理后台</h2><p className="mt-2 text-sm leading-6 text-slate-500">使用已加入企业的账号登录。</p></div>
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <Field label="邮箱"><Input type="email" autoComplete="username" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className="h-11 rounded-md px-3.5" /></Field>
          <Field label="密码"><Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入企业账号密码" className="h-11 rounded-md px-3.5" /></Field>
          <div className="flex items-start gap-2 border-l-2 border-teal-700 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600"><LockKeyhole size={14} className="mt-0.5 shrink-0 text-teal-800" /><span>账号需要属于一个处于启用状态的企业。</span></div>
          <ErrorText error={error} />
          <Button type="submit" loading={busy} className="h-11 w-full rounded-md bg-teal-800 hover:bg-teal-900">进入管理后台<ArrowRight size={16} /></Button>
        </form>
        <div className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
          平台运营账号？<Link className="font-medium text-teal-800 hover:text-teal-950" to="/super-admin">前往平台运营登录</Link>
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">可交付 AI 员工平台</p>
      </div>
    </section>
  </main>;
}

export function PlatformWorkspace() {
  const cache = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const identity = useQuery({ queryKey: ["platform-identity"], queryFn: () => adminRequest<{ userId: string; platformAdmin: boolean }>("/v1/platform/me"), retry: false });
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await adminRequest("/v1/platform-auth/login", { method: "POST", body: { email, password } });
      setPassword("");
      cache.removeQueries({ queryKey: ["admin-page"] });
      await identity.refetch();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  async function logout() {
    setError(undefined);
    try {
      await adminRequest("/v1/platform-auth/logout", { method: "POST" });
      cache.removeQueries({ queryKey: ["admin-page"] });
      cache.setQueryData(["platform-identity"], null);
      await identity.refetch();
    } catch (err) { setError(err); }
  }
  if (identity.isLoading) return <Spinner />;
  if (!identity.data?.platformAdmin) return <main className="grid min-h-screen bg-white text-slate-900 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
    <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-slate-200 bg-[#f3f7f5] p-10 lg:flex xl:p-14">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-800 text-white"><ShieldCheck size={20} /></span><div><div className="text-sm font-semibold">WorkAgent</div><div className="text-xs text-slate-500">平台运营控制台</div></div></div>
      <div className="relative z-10 max-w-xl">
        <div className="mb-5 inline-flex items-center gap-2 border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800"><Activity size={14} />独立平台管理会话</div>
        <h1 className="max-w-lg text-4xl font-semibold leading-tight text-slate-900">平台运营<br />统一工作区</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">管理租户目录、运行环境、调度任务与平台审计。平台身份与企业账号相互独立。</p>
        <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
          <div className="border border-slate-200 bg-white p-4"><Server size={17} className="text-teal-800" /><div className="mt-3 text-sm font-medium">运行与调度</div><div className="mt-1 text-xs text-slate-500">环境、Profiles、网关</div></div>
          <div className="border border-slate-200 bg-white p-4"><KeyRound size={17} className="text-emerald-700" /><div className="mt-3 text-sm font-medium">租户与治理</div><div className="mt-1 text-xs text-slate-500">目录、租户、审计</div></div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500"><span>WORKAGENT OPERATIONS</span><span>受保护的管理入口</span></div>
    </section>
    <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-800 text-white"><ShieldCheck size={18} /></span><div><div className="text-sm font-semibold">WorkAgent</div><div className="text-xs text-slate-500">平台运营</div></div></div>
        <div className="mb-8"><p className="text-xs font-semibold text-teal-800">PLATFORM OPERATIONS</p><h2 className="mt-2 text-2xl font-semibold">登录管理控制台</h2><p className="mt-2 text-sm leading-6 text-slate-500">使用已授予平台运营权限的独立账号登录。</p></div>
        <form onSubmit={(event) => void login(event)} className="space-y-5">
          <Field label="平台邮箱"><Input type="email" autoComplete="username" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className="h-11 rounded-md px-3.5" /></Field>
          <Field label="密码"><Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入平台账号密码" className="h-11 rounded-md px-3.5" /></Field>
          <div className="flex items-start gap-2 border-l-2 border-teal-700 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600"><LockKeyhole size={14} className="mt-0.5 shrink-0 text-teal-800" /><span>企业管理员身份不会自动获得平台访问权限。</span></div>
          <ErrorText error={error ?? identity.error} />
          <Button type="submit" loading={busy} className="h-11 w-full rounded-md bg-teal-800 hover:bg-teal-900">进入平台运营<ArrowRight size={16} /></Button>
        </form>
        <p className="mt-8 text-center text-xs text-slate-400">仅限授权的 WorkAgent 平台管理员</p>
      </div>
    </section>
  </main>;
  return <AdminLayout shell="platform" identity={identity.data.userId} role="平台管理员" onLogout={() => void logout()}><ErrorText error={error} /><AdminRoutes shell="platform" /></AdminLayout>;
}
