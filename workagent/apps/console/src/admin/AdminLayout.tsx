import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, Shield, Building2 } from "lucide-react";
import { Button, Select } from "@workagent/ui";
import { platformNavigation, tenantNavigation, type AdminShell } from "./navigation.js";

export function AdminLayout({
  shell,
  identity,
  role,
  onLogout,
  children,
}: {
  shell: AdminShell;
  identity: string;
  role: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const groups = shell === "platform" ? platformNavigation : tenantNavigation;
  const brandSubtitle = shell === "platform" ? "平台运营" : "租户管理";
  const current = groups.flatMap((group) => group.items).find((item) =>
    item.path === "/super-admin" || item.path === "/tenant/overview"
      ? item.path === location.pathname
      : location.pathname.startsWith(item.path),
  );
  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.gated !== "observability" || import.meta.env.VITE_ENABLE_PLATFORM_OBSERVABILITY === "true") }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-[#f4f7f7] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[68px] items-center gap-3 border-b border-slate-100 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white">
            {shell === "platform" ? <Shield size={18} /> : <Building2 size={18} />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Operations Console</div>
            <div className="text-xs text-slate-500">{brandSubtitle}</div>
          </div>
        </div>
        <nav aria-label={`${brandSubtitle}导航`} className="wa-scrollbar flex-1 overflow-y-auto px-3 py-3">
          {visibleGroups.map((group) => (
            <section key={group.label} className="mb-4">
              <h2 className="px-3 pb-1.5 pt-2 text-[11px] font-semibold text-slate-500">{group.label}</h2>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/super-admin" || item.path === "/tenant/overview"}
                      className={({ isActive }) => `flex min-h-9 items-center gap-2.5 rounded-md border-l-2 px-3 text-[13px] transition-colors ${isActive ? "border-teal-700 bg-teal-50 font-medium text-teal-800" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                    >
                      <Icon size={16} strokeWidth={1.8} />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-2 rounded-md px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{identity.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{identity}</div>
              <div className="truncate text-[11px] text-slate-500">{role}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout} aria-label="退出登录" title="退出登录" className="px-2"><LogOut size={15} /></Button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex min-h-[56px] items-center gap-3 px-4 sm:px-6">
            <Button variant="ghost" size="sm" className="lg:hidden" aria-label="打开导航" onClick={() => setMobileOpen((value) => !value)}><Menu size={18} /></Button>
            <div className="min-w-0 flex-1 text-sm text-slate-500">
              <span>{brandSubtitle}</span><span className="mx-2 text-slate-300">/</span><strong className="font-medium text-slate-800">{current?.label ?? "工作区"}</strong>
            </div>
            {shell === "platform" ? <Link className="hidden text-xs text-slate-500 hover:text-teal-800 sm:block" to="/tenant/overview">租户管理</Link> : <Link className="hidden text-xs text-slate-500 hover:text-teal-800 sm:block" to="/super-admin">平台运营</Link>}
            <span className="max-w-[150px] truncate text-xs text-slate-600">{identity}</span>
          </div>
          {mobileOpen && (
            <div className="border-t border-slate-100 bg-white px-4 py-3 lg:hidden">
              <label className="mb-1 block text-xs text-slate-500">页面导航</label>
              <Select aria-label="页面导航" value={current?.path ?? ""} onChange={(event) => { navigate(event.target.value); setMobileOpen(false); }}>
                {visibleGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}</optgroup>)}
              </Select>
              <Button variant="outline" size="sm" className="mt-3" onClick={onLogout}><LogOut size={14} />退出登录</Button>
            </div>
          )}
        </header>
        <main className="mx-auto min-h-[calc(100vh-56px)] max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
