import { tx } from "@workagent/db";
import { hashPassword } from "./crypto.js";
import { badRequest, conflict, notFound } from "./errors.js";
export async function provision(input: {
  action: string;
  email: string;
  slug?: string;
  name?: string;
  password?: string;
}) {
  const { action, slug, name } = input;
  const email = input.email.toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !["tenant", "platform", "revoke-platform", "rotate"].includes(action)
  )
    throw badRequest("Invalid provisioning arguments");
  if (
    action === "tenant" &&
    (!slug || !/^[a-z0-9-]{3,80}$/.test(slug) || !name?.trim())
  )
    throw badRequest("Tenant slug and name required");
  let hash: string | undefined;
  if (action !== "revoke-platform") {
    const p = input.password ?? "";
    if (p.length < 16 || Buffer.byteLength(p) > 72 || new Set(p).size < 8)
      throw badRequest("Use a unique strong password of 16 to 72 UTF-8 bytes");
    hash = await hashPassword(p);
  }
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))", [
      email,
    ]);
    let user = (
      await c.query<{ id: string }>(
        "SELECT id FROM app_user WHERE email=$1 FOR UPDATE",
        [email],
      )
    ).rows[0];
    if (["rotate", "revoke-platform"].includes(action) && !user)
      throw notFound();
    if (["tenant", "platform"].includes(action) && user)
      throw conflict(
        "Identity already exists; use explicit lifecycle commands",
      );
    if (!user)
      user = (
        await c.query<{ id: string }>(
          "INSERT INTO app_user(email,name,password_hash) VALUES($1,$2,$3) RETURNING id",
          [email, name ?? email, hash],
        )
      ).rows[0]!;
    if (action === "tenant") {
      const org = (
        await c.query<{ id: string }>(
          "INSERT INTO org(name,slug) VALUES($1,$2) RETURNING id",
          [name, slug],
        )
      ).rows[0]!;
      await c.query(
        "INSERT INTO membership(org_id,user_id,role,status) VALUES($1,$2,'owner','active')",
        [org.id, user.id],
      );
      await c.query(
        "INSERT INTO quota(org_id,scope,scope_id) VALUES($1,'org',$1)",
        [org.id],
      );
      await c.query(
        "INSERT INTO audit_log(org_id,actor_id,action,resource_type,resource_id) VALUES($1,$2,'provision.tenant','org',$1)",
        [org.id, user.id],
      );
      return { orgId: org.id, userId: user.id };
    }
    if (action === "platform")
      await c.query("INSERT INTO platform_admin(user_id) VALUES($1)", [
        user.id,
      ]);
    if (action === "revoke-platform") {
      await c.query("DELETE FROM platform_admin WHERE user_id=$1", [user.id]);
      await c.query("DELETE FROM platform_session WHERE user_id=$1", [user.id]);
    }
    if (action === "rotate") {
      await c.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
        user.id,
        hash,
      ]);
      await c.query("DELETE FROM session WHERE user_id=$1", [user.id]);
      await c.query("DELETE FROM platform_session WHERE user_id=$1", [user.id]);
    }
    await c.query("INSERT INTO platform_audit(user_id,action) VALUES($1,$2)", [
      user.id,
      "provision." + action,
    ]);
    return { userId: user.id };
  });
}
