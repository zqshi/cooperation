import { query } from "@workagent/db";

export type AuditInput = {
  orgId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

export async function audit(
  input: AuditInput,
  client?: { query: (text: string, params?: unknown[]) => Promise<unknown> },
): Promise<void> {
  await (client?.query.bind(client) ?? query)(
    `INSERT INTO audit_log (org_id, actor_id, action, resource_type, resource_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      input.orgId,
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ip ?? null,
    ],
  );
}
