import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PageHeader,
  useAuth,
  get,
  ErrorText,
  Spinner,
  Stat,
  Card,
  DataTable,
  StatusBadge,
  formatDate,
  Badge,
} from "@workagent/ui";
import type { TenantHome } from "@workagent/contracts";
export function TenantOverview() {
  const { user } = useAuth();
  const manage = ["owner", "admin"].includes(user!.role);
  const build = ["owner", "admin", "builder"].includes(user!.role);
  const q = useQuery({
    queryKey: ["tenant-home"],
    queryFn: () => get<TenantHome>("/v1/tenant-home"),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageHeader
        title="企业总览"
        description="了解工作进展，准备可用的 Agent，关注需要处理的事项。"
        actions={
          build && (
            <Link className="wa-action" to="/tenant/agents">
              管理 Agent →
            </Link>
          )
        }
      />
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        q.data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="近 7 天执行"
                value={q.data.counts.runs}
                hint="当前身份可访问的执行"
              />
              <Stat
                label="需要审批"
                value={q.data.counts.pending}
                tone="amber"
              />
              <Stat
                label="失败 / 超时"
                value={q.data.counts.failed}
                hint="近 7 天"
              />
              <Stat
                label="已发布 Agent"
                value={q.data.counts.published}
                hint={`共 ${q.data.counts.agents} 个 Agent`}
              />
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-[2fr_1fr]">
              <Card
                title="最近执行"
                description="最近的 Agent 执行与状态"
                padding={false}
              >
                <DataTable
                  rows={q.data.recent}
                  keyFor={(r) => r.id}
                  empty="暂无执行记录"
                  columns={[
                    {
                      key: "agent",
                      header: "Agent",
                      render: (r) => r.agentName,
                    },
                    {
                      key: "status",
                      header: "状态",
                      render: (r) => <StatusBadge status={r.status} />,
                    },
                    {
                      key: "date",
                      header: "发起时间",
                      render: (r) => formatDate(r.createdAt),
                    },
                  ]}
                />
              </Card>
              <Card
                title="使用准备"
                description="网页任务与 IM 接入可分别准备。"
              >
                <ul className="wa-readiness">
                  <li>
                    <strong>模型服务</strong>
                    <Badge
                      tone={
                        q.data.readiness.modelConfigured ? "green" : "amber"
                      }
                    >
                      {q.data.readiness.modelConfigured ? "已配置" : "待配置"}
                    </Badge>
                    <p>
                      {q.data.readiness.modelConfigured
                        ? "可发起预览验证服务响应。"
                        : "请联系部署管理员配置模型密钥；草稿仍可保存。"}
                    </p>
                  </li>
                  <li>
                    <strong>Agent 发布</strong>
                    <Badge>{q.data.counts.published} 个可用</Badge>
                    {build && <Link to="/tenant/agents">构建与发布 →</Link>}
                  </li>
                  <li>
                    <strong>知识库</strong>
                    <span>{q.data.counts.knowledge} 个</span>
                    {build && <Link to="/tenant/knowledge">维护知识 →</Link>}
                  </li>
                  <li>
                    <strong>IM 集成</strong>
                    <span>
                      {q.data.readiness.configuredChannels} /{" "}
                      {q.data.counts.channels} 个已配置
                    </span>
                    <p>
                      {q.data.counts.channels
                        ? "已保存配置，消息连通未验证。"
                        : "需要时添加渠道并绑定企业成员。"}
                    </p>
                    {manage && <Link to="/tenant/channels">管理渠道 →</Link>}
                  </li>
                </ul>
              </Card>
            </div>
            {manage && (
              <div className="mt-5 flex flex-wrap gap-5 text-sm text-blue-700">
                <Link to="/tenant/queue">处理执行队列 →</Link>
                <Link to="/tenant/members">成员与权限 →</Link>
                <Link to="/tenant/usage">成本与用量 →</Link>
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
