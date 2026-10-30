import { config } from "@workagent/config";
import { scanObjectBatch, deleteObject } from "./storage.js";
import { one, query } from "@workagent/db";
import { tx } from "@workagent/db";
/** Bounded, repeatable expiry cleanup. Referenced business records and tool ledgers are retained. */
export async function cleanupExpired() {
  const expired = await tx(async (c) => {
    const counts: Record<string, number> = {};
    for (const [table, predicate] of [
      ["session", "expires_at<now()"],
      ["platform_session", "expires_at<now()"],
      ["channel_replay", "received_at<now()-interval '7 days'"],
      [
        "idempotency_record",
        "created_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM agent_run r WHERE r.id=idempotency_record.response->>'runId')",
      ],
    ]) {
      const r = await c.query(
        `DELETE FROM ${table} WHERE ctid IN(SELECT ctid FROM ${table} WHERE ${predicate} LIMIT 500)`,
      );
      counts[table!] = r.rowCount ?? 0;
    }
    return counts;
  });
  expired.orphan_objects = 0;
  for (const object of await scanObjectBatch()) {
    if (
      object.modified.getTime() >=
      Date.now() - config.retentionDays * 86400000
    )
      continue;
    const orgId = object.key.split("/")[0];
    // Unknown prefixes are retained for explicit operator reconciliation.
    if (!(await one("SELECT id FROM org WHERE id=$1", [orgId]))) continue;
    if (
      await one(
        "SELECT storage_key FROM artifact WHERE storage_key=$1 UNION ALL SELECT storage_key FROM document WHERE storage_key=$1 LIMIT 1",
        [object.key],
      )
    )
      continue;
    await deleteObject(object.key);
    expired.orphan_objects++;
    await query(
      "INSERT INTO audit_log(org_id,action,resource_type,resource_id,metadata) VALUES($1,'storage.orphan.expired','object',$2,$3::jsonb)",
      [
        orgId,
        object.key,
        JSON.stringify({ retentionDays: config.retentionDays }),
      ],
    );
  }
  return expired;
}
