import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, useAuth } from "@workagent/ui";
import { ProfileForm } from "./ProfileForm.js";

/** This page deliberately sits outside PortalShell and all feature routes. */
export function ProvisionPage() {
  const { user, logout } = useAuth();
  const cache = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="wa-provision">
      <header className="wa-provision-header">
        <strong>WorkAgent</strong>
        <div>
          <span>{user?.name}</span>
          <button onClick={() => void logout()}>退出登录</button>
        </div>
      </header>
      <main className="wa-provision-main">
        <div className="wa-provision-intro">
          <span className="wa-provision-mark" aria-hidden="true">
            ✦
          </span>
          <h1>创建我的搭档</h1>
          <p>从你的工作职责与协作习惯开始，认识一位只属于你的工作搭档。</p>
        </div>
        <Card>
          <ProfileForm
            onSaved={() => {
              navigate("/", { replace: true });
              void cache.invalidateQueries({
                queryKey: ["personal-assistant", user?.orgId, user?.id],
              });
            }}
          />
        </Card>
      </main>
    </div>
  );
}
