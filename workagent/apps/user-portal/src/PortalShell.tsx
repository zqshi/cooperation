import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth, type NavItem } from "@workagent/ui";
export function PortalShell({
  nav,
  children,
}: {
  nav: NavItem[];
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen">
      <a href="#workspace" className="sr-only focus:not-sr-only">
        跳到工作区
      </a>
      <header className="wa-topbar">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong>WorkAgent</strong>
            <span className="ml-3 text-sm text-slate-500">Portal</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>{user?.name}</span>
            <button
              onClick={() => void logout()}
              className="rounded-lg border border-slate-200 px-3 py-2"
            >
              退出登录
            </button>
          </div>
        </div>
        <nav aria-label="员工工作导航" className="portal-flat-nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <item.icon className="h-4 w-4 shrink-0" />{item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="workspace" className="mx-auto max-w-6xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
