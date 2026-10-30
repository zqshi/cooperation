import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { get, PageHeader, ErrorText, Spinner, Card } from "@workagent/ui";
import type { Message } from "@workagent/contracts";
export function ConversationDetailPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["conversation", id],
    queryFn: () =>
      get<{ items: Message[] }>(`/v1/conversations/${id}/messages`),
    enabled: !!id,
  });
  return (
    <>
      <Link to="/conversations">返回会话</Link>
      <PageHeader title="会话记录" />
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        q.data?.items.map((m) => (
          <Card key={m.id}>
            <p>{m.role}</p>
            <p className="whitespace-pre-wrap">{m.content}</p>
          </Card>
        ))
      )}
    </>
  );
}
