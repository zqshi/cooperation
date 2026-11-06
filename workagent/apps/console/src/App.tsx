import { Navigate, useLocation } from "react-router-dom";
import { PlatformWorkspace, TenantWorkspace } from "./admin/AdminWorkspace.js";

export default function App() {
  const { pathname } = useLocation();
  if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) return <PlatformWorkspace />;
  if (pathname === "/tenant" || pathname.startsWith("/tenant/")) return <TenantWorkspace />;
  return <Navigate to="/tenant/overview" replace />;
}
