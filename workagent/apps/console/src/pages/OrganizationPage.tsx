import { useQuery } from "@tanstack/react-query";
import { get, PageHeader, Card, ErrorText, Spinner } from "@workagent/ui";
import type { Org } from "@workagent/contracts";
export function OrganizationPage() {
  const q = useQuery({
    queryKey: ["org"],
    queryFn: () => get<{ org: Org | null }>("/v1/org"),
  });
  return (
    <>
      <PageHeader
        title="企业治理"
        description="WorkAgent 面向中小企业的独立 AI 工作平台"
      />
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : q.data?.org ? (
        <Card>
          <p>企业：{q.data.org.name}</p>
          <p>标识：{q.data.org.slug}</p>
          <p>套餐：{q.data.org.plan}</p>
        </Card>
      ) : (
        <p>未找到企业信息</p>
      )}
    </>
  );
}
