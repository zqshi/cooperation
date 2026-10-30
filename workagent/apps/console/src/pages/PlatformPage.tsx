import { useState } from "react";
import {
  post,
  Button,
  Input,
  Field,
  Card,
  DataTable,
  Modal,
  Select,
  Stat,
  Badge,
  patch,
  ApiError,
  formatDate,
  formatCost,
} from "@workagent/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Routes,
  Route,
  Navigate,
  Link,
  useParams,
  useNavigate,
} from "react-router-dom";
import { Building2, LayoutDashboard, ScrollText } from "lucide-react";
import { AppShell, get, Spinner, ErrorText, PageHeader } from "@workagent/ui";
import type {
  PlatformOverview,
  PlatformTenant,
  PlatformTenantDetail,
  PlatformAuditRow,
} from "@workagent/contracts";
export function PlatformPage() {
  const cache = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>();
  const identity = useQuery({
    queryKey: ["platform-identity"],
    queryFn: () =>
      get<{ userId: string; platformAdmin: boolean }>("/v1/platform/me"),
    retry: false,
  });
  if (identity.isLoading) return <Spinner />;
  const nav = [
    { to: "/super-admin", label: "平台概览", icon: LayoutDashboard, end: true },
    { to: "/super-admin/tenants", label: "租户管理", icon: Building2 },
    { to: "/super-admin/audit", label: "操作审计", icon: ScrollText },
  ];
  const logout = async () => {
    try {
      await post("/v1/platform-auth/logout");
      cache.removeQueries({ queryKey: ["platform-overview"] });
      cache.removeQueries({ queryKey: ["platform-tenants"] });
      cache.removeQueries({ queryKey: ["platform-tenant"] });
      cache.removeQueries({ queryKey: ["platform-audit"] });
      cache.setQueryData(["platform-identity"], null);
      await identity.refetch();
    } catch (err) {
      setError(err);
    }
  };
  if (
    identity.error &&
    (!(identity.error instanceof ApiError) ||
      ![401, 403].includes(identity.error.status))
  )
    return (
      <main className="mx-auto max-w-lg p-8">
        <ErrorText error={identity.error} />
        <Button className="mt-4" onClick={() => void identity.refetch()}>
          重新加载平台会话
        </Button>
      </main>
    );
  if (!identity.data)
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <div className="w-full max-w-md">
          <p className="mb-6 text-sm font-semibold text-slate-600">
            WorkAgent / 平台运营
          </p>
          <Card
            title="登录平台运营"
            description="独立平台账号与会话。企业管理员身份不授予平台权限。"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                void post("/v1/platform-auth/login", { email, password })
                  .then(() => {
                    setPassword("");
                    return identity.refetch();
                  })
                  .catch(setError);
              }}
            >
              <Field label="平台邮箱" className="w-full">
                <Input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="平台密码" className="w-full">
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <ErrorText error={error} />
              <Button type="submit" className="w-full">
                登录平台运营
              </Button>
            </form>
          </Card>
        </div>
      </main>
    );
  return (
    <AppShell
      nav={nav}
      subtitle="独立平台运营"
      identity={{
        name: identity.data.userId,
        role: "平台管理员",
        logout: () => void logout(),
      }}
    >
      <ErrorText error={error} />
      <Routes>
        <Route index element={<Overview />} />
        <Route path="tenants" element={<Tenants />} />
        <Route path="tenants/:id" element={<TenantDetail />} />
        <Route path="audit" element={<PlatformAudit />} />
        <Route path="*" element={<Navigate to="/super-admin" replace />} />
      </Routes>
    </AppShell>
  );
}

function Overview() {
  const q = useQuery({
    queryKey: ["platform-overview"],
    queryFn: () => get<PlatformOverview>("/v1/platform/overview"),
  });
  return (
    <>
      <PageHeader
        title="平台运营"
        description="管理企业开通、订阅方案和平台操作记录。"
        actions={
          <Link className="wa-action" to="/super-admin/tenants">
            租户管理 →
          </Link>
        }
      />
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        q.data && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat label="企业租户" value={q.data.tenantCount} />
            <Stat label="有效企业成员" value={q.data.activeMemberCount} />
          </div>
        )
      )}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Card
          title="企业开通"
          description="创建企业及初始负责人，配置方案后交付登录入口。"
        >
          <Link className="text-sm text-blue-700" to="/super-admin/tenants">
            查看和创建租户 →
          </Link>
        </Card>
        <Card
          title="操作追溯"
          description="查看独立平台身份的开通、配置与登录记录。"
        >
          <Link className="text-sm text-blue-700" to="/super-admin/audit">
            查看操作审计 →
          </Link>
        </Card>
      </div>
    </>
  );
}
function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-500">
      <span>
        共 {total} 条 · 第 {page} 页
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page * 20 >= total}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
function Tenants() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    plan: "trial",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["platform-tenants", search, page],
    queryFn: () =>
      get<{ items: PlatformTenant[]; total: number }>(
        `/v1/platform/tenants?search=${encodeURIComponent(search)}&page=${page}`,
      ),
  });
  const close = () => {
    if (busy) return;
    setOpen(false);
    setForm({ ...form, ownerPassword: "" });
    setError(null);
  };
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ orgId: string }>(
        "/v1/platform/tenants",
        form,
      );
      setForm({
        name: "",
        slug: "",
        plan: "trial",
        ownerName: "",
        ownerEmail: "",
        ownerPassword: "",
      });
      setOpen(false);
      await cache.invalidateQueries({ queryKey: ["platform-tenants"] });
      await cache.invalidateQueries({ queryKey: ["platform-overview"] });
      navigate(`/super-admin/tenants/${result.orgId}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="租户管理"
        description="企业开通与方案配置"
        actions={<Button onClick={() => setOpen(true)}>创建租户</Button>}
      />
      <div className="mb-4 max-w-sm">
        <Input
          aria-label="搜索租户"
          placeholder="搜索企业名称或标识"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card padding={false}>
          <DataTable
            rows={q.data?.items ?? []}
            keyFor={(t) => t.id}
            empty="没有匹配的租户"
            columns={[
              {
                key: "name",
                header: "企业",
                render: (t) => (
                  <Link
                    className="font-medium text-blue-700"
                    to={`/super-admin/tenants/${t.id}`}
                  >
                    {t.name}
                  </Link>
                ),
              },
              { key: "slug", header: "标识", render: (t) => t.slug },
              {
                key: "plan",
                header: "方案",
                render: (t) => <Badge>{t.plan}</Badge>,
              },
              {
                key: "members",
                header: "有效成员",
                render: (t) => t.activeMemberCount,
              },
              {
                key: "created",
                header: "创建时间",
                render: (t) => formatDate(t.createdAt),
              },
            ]}
          />
        </Card>
      )}
      <Pager page={page} total={q.data?.total ?? 0} onChange={setPage} />
      <Modal
        open={open}
        title="创建企业租户"
        description="初始负责人使用企业登录入口。请通过安全方式交付你填写的密码。"
        onClose={close}
      >
        <form
          className="wa-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {(
            [
              ["name", "企业名称"],
              ["slug", "企业标识"],
              ["ownerName", "负责人姓名"],
              ["ownerEmail", "负责人邮箱"],
              ["ownerPassword", "初始密码"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              hint={
                key === "ownerPassword"
                  ? "至少 16 字符，最多 72 UTF-8 字节。"
                  : key === "slug"
                    ? "小写字母、数字和短横线，3–80 字符。"
                    : undefined
              }
            >
              <Input
                required
                type={
                  key === "ownerPassword"
                    ? "password"
                    : key === "ownerEmail"
                      ? "email"
                      : "text"
                }
                autoComplete={key === "ownerPassword" ? "new-password" : "off"}
                minLength={key === "ownerPassword" ? 16 : undefined}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="订阅方案">
            <Select
              value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}
            >
              <option value="trial">trial</option>
              <option value="team">team</option>
              <option value="enterprise">enterprise</option>
            </Select>
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={close}>
              取消
            </Button>
            <Button type="submit" loading={busy}>
              创建并开通负责人
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
function TenantDetail() {
  const { id } = useParams();
  const cache = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("trial");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["platform-tenant", id],
    queryFn: () =>
      get<{ tenant: PlatformTenantDetail }>(`/v1/platform/tenants/${id}`),
  });
  const t = q.data?.tenant;
  return (
    <>
      <Link
        className="mb-4 inline-block text-sm text-slate-500"
        to="/super-admin/tenants"
      >
        ← 租户管理
      </Link>
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        t && (
          <>
            <PageHeader
              title={t.name}
              description={`${t.slug} · 创建于 ${formatDate(t.createdAt)}`}
              actions={
                <Button
                  variant="outline"
                  onClick={() => {
                    setName(t.name);
                    setPlan(t.plan);
                    setEdit(true);
                  }}
                >
                  配置企业
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Stat label="订阅方案" value={t.plan} />
              <Stat label="有效成员" value={t.activeMemberCount} />
              <Stat label="Agent" value={t.agentCount} />
              <Stat label="执行总数" value={t.runCount} />
              <Stat
                label="文件存储"
                value={`${(t.storageBytes / 1024 / 1024).toFixed(2)} MB`}
                hint="登记的知识文件与产物大小"
              />
              <Stat label="累计记录成本" value={formatCost(t.costUsd)} />
            </div>
            <Card className="mt-6" title="企业已开通">
              <p className="text-sm text-slate-600">
                负责人使用企业登录页及创建时填写的邮箱、密码登录，开始构建 Agent
                和组织项目工作。
              </p>
              <p className="mt-2 text-xs text-slate-500">
                此视图仅展示运营汇总。
              </p>
            </Card>
          </>
        )
      )}
      <Modal
        open={edit}
        title="配置企业"
        onClose={() => {
          if (!busy) setEdit(false);
        }}
      >
        <form
          className="wa-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await patch(`/v1/platform/tenants/${id}`, { name, plan });
              setEdit(false);
              await cache.invalidateQueries({
                queryKey: ["platform-tenant", id],
              });
              await cache.invalidateQueries({ queryKey: ["platform-tenants"] });
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="企业名称">
            <Input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="方案">
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option>trial</option>
              <option>team</option>
              <option>enterprise</option>
            </Select>
          </Field>
          <ErrorText error={error} />
          <Button type="submit" loading={busy}>
            保存配置
          </Button>
        </form>
      </Modal>
    </>
  );
}
function PlatformAudit() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["platform-audit", page],
    queryFn: () =>
      get<{ items: PlatformAuditRow[]; total: number }>(
        `/v1/platform/audit?page=${page}`,
      ),
  });
  return (
    <>
      <PageHeader
        title="平台操作审计"
        description="企业开通、配置及平台会话记录"
      />
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card padding={false}>
          <DataTable
            rows={q.data?.items ?? []}
            keyFor={(r) => r.id}
            columns={[
              {
                key: "action",
                header: "操作",
                render: (r) =>
                  ({
                    "tenant.create": "创建租户",
                    "tenant.configure": "配置租户",
                    "platform.login": "平台登录",
                    "platform.logout": "平台退出",
                  })[r.action] ?? r.action,
              },
              { key: "actor", header: "操作人", render: (r) => r.userId },
              {
                key: "org",
                header: "企业",
                render: (r) =>
                  r.orgId ? (
                    <Link
                      className="text-blue-700"
                      to={`/super-admin/tenants/${r.orgId}`}
                    >
                      {r.orgId}
                    </Link>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "time",
                header: "时间",
                render: (r) => formatDate(r.createdAt),
              },
            ]}
          />
        </Card>
      )}
      <Pager page={page} total={q.data?.total ?? 0} onChange={setPage} />
    </>
  );
}
