import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "./auth.js";
import { Button, ErrorText, Input } from "./components.js";

export function LoginPage({
  title = "登录 WorkAgent",
  subtitle = "把重复工作交给可验收的数字员工",
  demo = false,
}: {
  title?: string;
  subtitle?: string;
  demo?: boolean;
}) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(demo ? "admin@workagent.local" : "");
  const [password, setPassword] = useState(demo ? "admin12345" : "");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const from =
    (location.state as { from?: string } | null)?.from ??
    `${location.pathname}${location.search}${location.hash}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">WorkAgent</p>
            <p className="text-xs text-slate-500">可交付 AI 员工平台</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          <form onSubmit={submit} className="wa-form mt-5">
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="text-xs font-medium text-slate-600"
              >
                邮箱
              </label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="text-xs font-medium text-slate-600"
              >
                密码
              </label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <ErrorText error={error} />
            <Button type="submit" loading={loading} className="w-full">
              登录
            </Button>
          </form>
          {demo ? (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
              演示账号：admin@workagent.local / admin12345
              <br />
              首次使用请先执行 pnpm db:migrate && pnpm db:seed
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
