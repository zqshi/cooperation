import { TenantOverview } from "./pages/TenantOverview.js";
import { QueuePage } from "./pages/QueuePage.js";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  AppShell,
  LoginPage,
  Spinner,
  useAuth,
  type NavItem,
} from "@workagent/ui";
import {
  Building2,
  Users,
  Radio,
  ListTodo,
  ScrollText,
  ChartNoAxesCombined,
  Bot,
  Blocks,
  Plug,
  BookOpen,
  FlaskConical,
  LayoutDashboard,
} from "lucide-react";
import { OrganizationPage } from "./pages/OrganizationPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { ChannelsPage } from "./pages/ChannelsPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { UsagePage } from "./pages/UsagePage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { AgentDetailPage } from "./pages/AgentDetailPage.js";
import { SkillsPage } from "./pages/SkillsPage.js";
import { ConnectorsPage } from "./pages/ConnectorsPage.js";
import { KnowledgePage } from "./pages/KnowledgePage.js";
import { KnowledgeDetailPage } from "./pages/KnowledgeDetailPage.js";
import { EvalsPage } from "./pages/EvalsPage.js";
import { EvalDetailPage } from "./pages/EvalDetailPage.js";
import { PlatformPage } from "./pages/PlatformPage.js";
const sections = [
  ["overview", "企业总览", ["owner", "admin", "builder", "auditor"]],
  ["org", "企业", ["owner", "admin", "auditor"]],
  ["members", "成员", ["owner", "admin"]],
  ["channels", "渠道", ["owner", "admin"]],
  ["queue", "执行队列", ["owner", "admin", "auditor"]],
  ["audit", "审计", ["owner", "admin", "auditor"]],
  ["usage", "成本", ["owner", "admin", "auditor"]],
  ...["agents", "skills", "connectors", "knowledge", "evals"].map((key, i) => [
    key,
    ["Agent", "Skill", "Connector", "知识库", "评测"][i]!,
    ["owner", "admin", "builder"],
  ]),
] as [string, string, string[]][];
function TenantShell() {
  const { user } = useAuth();
  const order = [
    "overview",
    "agents",
    "skills",
    "connectors",
    "knowledge",
    "evals",
    "queue",
    "audit",
    "usage",
    "org",
    "members",
    "channels",
  ];
  const visible = sections
    .filter((s) => s[2].includes(user!.role))
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const nav: NavItem[] = visible.map(([key, label]) => ({
    to: `/tenant/${key}`,
    label,
    icon:
      {
        overview: LayoutDashboard,
        org: Building2,
        members: Users,
        channels: Radio,
        queue: ListTodo,
        audit: ScrollText,
        usage: ChartNoAxesCombined,
        agents: Bot,
        skills: Blocks,
        connectors: Plug,
        knowledge: BookOpen,
        evals: FlaskConical,
      }[key] ?? Building2,
    group:
      key === "overview"
        ? "工作总览"
        : ["org", "members", "channels"].includes(key)
          ? "企业与接入"
          : ["queue", "audit", "usage"].includes(key)
            ? "运行与治理"
            : "Agent 构建",
  }));
  const pages = {
    overview: <TenantOverview />,
    queue: <QueuePage />,
    org: <OrganizationPage />,
    members: <MembersPage />,
    channels: <ChannelsPage />,
    audit: <AuditPage />,
    usage: <UsagePage />,
    agents: <AgentsPage />,
    skills: <SkillsPage />,
    connectors: <ConnectorsPage />,
    knowledge: <KnowledgePage />,
    evals: <EvalsPage />,
  };
  const build = ["owner", "admin", "builder"].includes(user!.role);
  return (
    <AppShell nav={nav} subtitle="企业管理">
      <Routes>
        {Object.entries(pages).map(([key, page]) => (
          <Route
            key={key}
            path={key}
            element={
              visible.some((s) => s[0] === key) ? (
                page
              ) : (
                <p role="alert">无权访问</p>
              )
            }
          />
        ))}
        <Route
          path="agents/:id"
          element={build ? <AgentDetailPage /> : <p role="alert">无权访问</p>}
        />
        <Route
          path="knowledge/:id"
          element={
            build ? <KnowledgeDetailPage /> : <p role="alert">无权访问</p>
          }
        />
        <Route
          path="evals/:id"
          element={build ? <EvalDetailPage /> : <p role="alert">无权访问</p>}
        />
        <Route
          path="*"
          element={
            visible[0] ? (
              <Navigate to={`/tenant/${visible[0][0]}`} replace />
            ) : (
              <p role="alert">无企业管理权限</p>
            )
          }
        />
      </Routes>
    </AppShell>
  );
}
export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (location.pathname.startsWith("/super-admin"))
    return (
      <Routes>
        <Route path="/super-admin/*" element={<PlatformPage />} />
      </Routes>
    );
  if (loading) return <Spinner />;
  if (!user) return <LoginPage title="登录管理控制台" />;
  return (
    <Routes>
      <Route path="/tenant/*" element={<TenantShell />} />
      <Route path="/super-admin/*" element={<PlatformPage />} />
      <Route path="*" element={<Navigate to="/tenant" replace />} />
    </Routes>
  );
}
