import { usePersonalAssistant } from "./lib/personal.js";
import { ProvisionPage } from "./pages/ProvisionPage.js";
import { PersonalPage } from "./pages/PersonalPage.js";
import {
  PersonalUsagePage,
  PersonalAuthorizationPage,
} from "./pages/PersonalOpsPage.js";
import { PortalShell } from "./PortalShell.js";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  LoginPage,
  Spinner,
  ErrorText,
  Button,
  useAuth,
  type NavItem,
} from "@workagent/ui";
import { Bot, BookOpen, Brain, ListTodo, MonitorSmartphone, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { ConversationsPage } from "./pages/ConversationsPage.js";
import { ConversationDetailPage } from "./pages/ConversationDetailPage.js";

import { AutomationPage } from "./pages/AutomationPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { PersonalGrowthPage, PortalCapabilityPage, PortalContentPage, PortalDevicesPage } from "./pages/PortalCapabilityPages.js";

const nav: NavItem[] = [
  { to: "/", label: "搭档档案", icon: Bot, end: true },
  { to: "/growth", label: "成长", icon: TrendingUp },
  { to: "/memory", label: "记忆", icon: Brain },
  { to: "/skills", label: "技能", icon: Sparkles },
  { to: "/knowledge", label: "知识", icon: BookOpen },
  { to: "/automations", label: "自动化", icon: ListTodo },
  { to: "/projects", label: "项目", icon: ListTodo },
  { to: "/authorization", label: "授权", icon: ShieldCheck },
  { to: "/devices", label: "设备", icon: MonitorSmartphone },
  { to: "/usage", label: "消耗", icon: ListTodo },
];

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="正在加载" />
      </div>
    );
  }

  if (!user) return <LoginPage title="登录 Portal" />;

  return <PersonalPortal key={`${user.orgId}:${user.id}`} />;
}

function PersonalPortal() {
  const state = usePersonalAssistant();
  if (state.isPending)
    return (
      <div className="wa-bootstrap">
        <Spinner label="正在加载" />
      </div>
    );
  if (state.isError)
    return (
      <div className="wa-bootstrap">
        <div role="alert">
          <h1>无法加载搭档资料</h1>
          <ErrorText error={state.error} />
          <Button onClick={() => void state.refetch()}>重试</Button>
        </div>
      </div>
    );
  if (!state.data.agent) return <ProvisionPage />;
  return (
    <PortalShell nav={nav}>
      <Routes>
        <Route path="/" element={<PersonalPage state={state.data} />} />
        <Route
          path="/workbench"
          element={<Navigate to="/projects" replace />}
        />
        <Route path="/authorization" element={<PersonalAuthorizationPage />} />
        <Route path="/devices" element={<PortalDevicesPage />} />
        <Route path="/growth" element={<PersonalGrowthPage />} />
        <Route path="/memory" element={<PortalCapabilityPage section="memoryEntries" />} />
        <Route path="/skills" element={<PortalCapabilityPage section="personalSkills" />} />
        <Route path="/knowledge" element={<PortalCapabilityPage section="knowledgeEntries" />} />
        <Route path="/content" element={<PortalContentPage />} />
        <Route path="/content/:id" element={<PortalContentPage />} />
        <Route path="/usage" element={<PersonalUsagePage />} />
        <Route path="/automations" element={<AutomationPage />} />
        <Route path="/automations/:id" element={<AutomationPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/agents" element={<Navigate to="/projects" replace />} />
        <Route path="/tasks" element={<Navigate to="/projects" replace />} />
        <Route
          path="/personal-runs"
          element={<Navigate to="/projects" replace />}
        />
        <Route path="/personal-runs/:id" element={<RunDetailPage />} />
        <Route path="/runs" element={<Navigate to="/projects" replace />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route
          path="/projects/:projectId/runs/:id"
          element={<RunDetailPage />}
        />
        <Route path="/tasks/:id" element={<RunDetailPage />} />
        <Route
          path="/approvals"
          element={<Navigate to="/projects" replace />}
        />
        <Route path="/conversations" element={<ConversationsPage />} />
        <Route path="/conversations/:id" element={<ConversationDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PortalShell>
  );
}
