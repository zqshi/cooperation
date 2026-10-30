import type { ComponentType, ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { LogOut, Sparkles } from "lucide-react";
import { useAuth } from "./auth.js";

export type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  group?: string;
};

export function AppShell({
  nav,
  children,
  brand = "WorkAgent",
  subtitle,
  identity,
}: {
  nav: NavItem[];
  children: ReactNode;
  brand?: string;
  subtitle?: string;
  identity?: { name: string; role: string; logout: () => void };
}) {
  const location = useLocation();
  const current = nav.find((item) =>
    item.end
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to),
  );
  const auth = useAuth();
  const user = identity ?? auth.user;
  const logout = identity?.logout ?? auth.logout;

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{brand}</p>
            {subtitle ? (
              <p className="text-[11px] text-slate-400">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <nav className="wa-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.to}>
                {item.group && item.group !== nav[index - 1]?.group ? (
                  <p className="wa-group">{item.group}</p>
                ) : null}
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                      isActive
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              {user?.name?.slice(0, 1).toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-800">
                {user?.name}
              </p>
              <p className="truncate text-[11px] text-slate-400">
                {(
                  {
                    owner: "企业所有者",
                    admin: "企业管理员",
                    builder: "构建者",
                    operator: "运营者",
                    user: "员工",
                    auditor: "审计员",
                  } as Record<string, string>
                )[user?.role ?? ""] ?? user?.role}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="退出登录"
              aria-label={identity ? "退出平台" : "退出登录"}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 md:pl-56">
        <header className="wa-console-context hidden md:flex">
          <span>
            {subtitle} <span className="mx-2 text-slate-300">/</span>{" "}
            <strong>{current?.label ?? "工作区"}</strong>
          </span>
          <span className="text-xs">
            {identity ? "平台运营空间" : "企业工作空间"}
          </span>
        </header>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-semibold">{brand}</span>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="text-xs text-slate-500"
            >
              {identity ? "退出平台" : "退出"}
            </button>
          </div>
          <nav className="wa-scrollbar flex gap-1 overflow-x-auto px-3 pb-2">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                      isActive
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-slate-500 hover:bg-slate-50",
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
