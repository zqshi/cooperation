import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get, PageHeader, ErrorText, Spinner, Card } from "@workagent/ui";
import type { ConversationRow } from "../lib/types.js";
export function ConversationsPage() {
  const q = useQuery({
    queryKey: ["conversations"],
    queryFn: () =>
      get<{ items: ConversationRow[] }>("/v1/conversations?pageSize=100"),
  });
  return (
    <>
      <PageHeader title="我的会话" />
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : q.data?.items.length === 0 ? (
        <p>暂无会话</p>
      ) : (
        q.data?.items.map((c) => (
          <Card key={c.id}>
            <Link to={`/conversations/${c.id}`}>{c.title}</Link>
            <p>
              {c.agentName} · {c.lastMessage}
            </p>
          </Card>
        ))
      )}
    </>
  );
}
