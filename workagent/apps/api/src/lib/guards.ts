import { tx } from "@workagent/db";
import type { AuthUser } from "@workagent/core";
import { canBuild, canManage, canOperate, forbidden } from "@workagent/core";

export function requireBuild(user: AuthUser): void {
  if (!canBuild(user)) throw forbidden("需要构建权限");
}

export function requireManage(user: AuthUser): void {
  if (!canManage(user)) throw forbidden("需要管理权限");
}

export function requireOperate(user: AuthUser): void {
  if (!canOperate(user)) throw forbidden("需要运营权限");
}

export function requireAudit(user: AuthUser): void {
  if (!["owner", "admin", "auditor"].includes(user.role))
    throw forbidden("需要审计权限");
}

/** Lock the live grant for the whole privileged mutation, including its audit. */
export async function sensitiveMutation<T>(
  user: AuthUser,
  permission: "build" | "manage",
  work: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  return tx(async (client) => {
    const row = (
      await client.query<{ role: AuthUser["role"] }>(
        "SELECT role FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
        [user.orgId, user.id],
      )
    ).rows[0];
    if (!row) throw forbidden();
    const live = { ...user, role: row.role };
    if (permission === "build") requireBuild(live);
    else requireManage(live);
    return work(client);
  });
}

export function transactionOne(client: import("pg").PoolClient) {
  return async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> =>
    ((await client.query(sql, params)).rows[0] as T) ?? null;
}
