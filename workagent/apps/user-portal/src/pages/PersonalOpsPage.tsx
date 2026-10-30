import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, ErrorText, Spinner, get } from "@workagent/ui";
export function PersonalUsagePage() {
  const data = useQuery({
    queryKey: ["personal-usage"],
    queryFn: () =>
      get<{
        summary: {
          runs: number;
          inputTokens: number;
          outputTokens: number;
          costUsd: number;
        };
        items: {
          runId: string;
          kind: string;
          inputTokens: number;
          outputTokens: number;
          costUsd: string;
          createdAt: string;
        }[];
      }>("/v1/personal-usage"),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">我的消耗</h1>
      <p className="text-sm text-slate-500">
        最近 30 天本人实际记账记录，包含个人与获准使用的企业 Agent。费用为 USD
        预估值。
      </p>
      <ErrorText error={data.error} />
      {data.isLoading ? (
        <Spinner />
      ) : (
        data.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["已记账执行", data.data.summary.runs],
                [
                  "Token",
                  data.data.summary.inputTokens +
                    data.data.summary.outputTokens,
                ],
                ["预估费用", `$${data.data.summary.costUsd.toFixed(4)}`],
              ].map(([label, value]) => (
                <Card key={label}>
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className="mt-3 text-2xl font-semibold">{value}</p>
                </Card>
              ))}
            </div>
            <Card>
              <h2 className="mb-4 font-medium">消耗明细 · 最近 100 条</h2>
              {!data.data.items.length ? (
                <p className="text-sm text-slate-500">
                  暂无实际记账记录。排队中的任务不代表已消耗。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="wa-personal-usage-table w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>任务</th>
                        <th>Token</th>
                        <th>USD</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.items.map((r, i) => (
                        <tr key={i}>
                          <td className="py-3">
                            <Link
                              className="text-blue-700"
                              to={`/tasks/${r.runId}`}
                            >
                              {r.runId.slice(0, 8)}
                            </Link>
                          </td>
                          <td>{r.inputTokens + r.outputTokens}</td>
                          <td>{Number(r.costUsd).toFixed(4)}</td>
                          <td className="whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleString("zh-CN", {
                              hour12: false,
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )
      )}
    </div>
  );
}
export function PersonalAuthorizationPage() {
  const data = useQuery({
    queryKey: ["my-channels"],
    queryFn: () =>
      get<{
        items: {
          id: string;
          name: string;
          type: string;
          status: string;
          configured: boolean;
          hasAgent: boolean;
        }[];
      }>("/v1/channels/mine"),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">我的授权与渠道</h1>
      <Card>
        <h2 className="font-semibold">网页 · 直接使用</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          使用当前企业身份发起工作。私人搭档仅本人可用；企业 Agent
          由企业发布，项目另需成员权限。个人搭档未获授任何 Connector
          凭证或外部工具。
        </p>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">已绑定的 IM 渠道</h2>
        <p className="mb-4 text-sm text-slate-500">
          IM
          是使用渠道之一。此处是企业已保存的本人绑定投影；不代表个人搭档已接入该渠道，也不证明厂商消息连通。
        </p>
        <ErrorText error={data.error} />
        {data.isLoading ? (
          <Spinner />
        ) : data.data?.items.length ? (
          data.data.items.map((c) => (
            <div key={c.id} className="border-t py-4">
              <h3 className="font-medium">
                {c.name} · {c.type}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                {c.status === "active" ? "配置启用" : "配置停用"} ·{" "}
                {c.configured ? "凭证已保存" : "缺少凭证"} ·{" "}
                {c.hasAgent ? "已配置企业 Agent" : "未配置 Agent"} ·
                消息连通未验证
              </p>
            </div>
          ))
        ) : (
          !data.isError && (
            <p className="text-sm text-slate-600">
              尚未绑定 IM。需要时请联系企业管理员核实身份并绑定。
            </p>
          )
        )}
      </Card>
    </div>
  );
}
