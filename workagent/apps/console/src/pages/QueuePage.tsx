import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  get,
  post,
  PageHeader,
  Card,
  Button,
  ErrorText,
  useAuth,
} from "@workagent/ui";
export function QueuePage() {
  const { user } = useAuth();
  const [error, setError] = useState<unknown>();
  const q = useQuery({
    queryKey: ["queue"],
    queryFn: () =>
      get<{
        items: {
          id: string;
          type: string;
          status: string;
          attempts: number;
          last_error: string | null;
        }[];
      }>("/v1/queue"),
    refetchInterval: 10000,
  });
  return (
    <>
      <PageHeader
        title="执行队列"
        description="失败任务进入死信队列；外部副作用不明确时先人工核对。"
      />
      <ErrorText error={error || q.error} />
      {q.data?.items.map((j) => (
        <Card key={j.id}>
          <p>
            {j.type} · {j.status} · 尝试 {j.attempts}
          </p>
          <p>{j.last_error}</p>
          {j.status === "failed" &&
            ["owner", "admin"].includes(user?.role ?? "") && (
              <Button
                onClick={() =>
                  void post(`/v1/queue/${j.id}/retry`)
                    .then(() => q.refetch())
                    .catch(setError)
                }
              >
                重试
              </Button>
            )}
        </Card>
      ))}
    </>
  );
}
