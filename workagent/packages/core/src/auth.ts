import { SignJWT, jwtVerify } from "jose";
import { config } from "@workagent/config";
import type { Role } from "@workagent/contracts";
import { one, query, tx } from "@workagent/db";
import { forbidden, unauthorized } from "./errors.js";
import { randomToken, sha256, verifyPassword } from "./crypto.js";

export const SESSION_COOKIE = "wa_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  org_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: Role;
  org_name: string;
  expires_at: string;
};

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const user = await one<{
    id: string;
    email: string;
    name: string;
    password_hash: string;
    avatar_url: string | null;
  }>(
    "SELECT id, email, name, password_hash, avatar_url FROM app_user WHERE email = $1",
    [email.toLowerCase()],
  );
  if (!user) throw unauthorized("邮箱或密码错误");
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw unauthorized("邮箱或密码错误");

  const membership = await one<{ org_id: string; role: Role }>(
    `SELECT m.org_id, m.role
       FROM membership m JOIN org o ON o.id=m.org_id AND o.status='active'
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY m.created_at
      LIMIT 1`,
    [user.id],
  );
  if (!membership) throw forbidden("该账号没有可用的组织成员身份");

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await query(
    `INSERT INTO session (user_id, org_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.id, membership.org_id, sha256(token), expiresAt],
  );

  const org = await one<{ name: string }>(
    "SELECT name FROM org WHERE id = $1",
    [membership.org_id],
  );
  return {
    token,
    user: {
      id: user.id,
      orgId: membership.org_id,
      orgName: org?.name ?? "",
      email: user.email,
      name: user.name,
      role: membership.role,
      avatarUrl: user.avatar_url,
    },
  };
}

export async function getSessionUser(
  token: string | undefined,
): Promise<AuthUser | null> {
  if (!token) return null;
  const row = await one<SessionRow>(
    `SELECT s.id, s.user_id, s.org_id, u.email, u.name, u.avatar_url, m.role, o.name AS org_name, s.expires_at
       FROM session s
       JOIN app_user u ON u.id = s.user_id
       JOIN membership m ON m.user_id = s.user_id AND m.org_id = s.org_id
       JOIN org o ON o.id = s.org_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND m.status = 'active' AND o.status='active'
      LIMIT 1`,
    [sha256(token)],
  );
  if (!row) return null;
  return {
    id: row.user_id,
    orgId: row.org_id,
    orgName: row.org_name,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url,
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await query("DELETE FROM session WHERE token_hash = $1", [sha256(token)]);
}

export function requireRole(user: AuthUser, roles: Role[]): void {
  if (!roles.includes(user.role)) throw forbidden();
}

export function canManage(user: AuthUser): boolean {
  return ["owner", "admin"].includes(user.role);
}

export function canBuild(user: AuthUser): boolean {
  return ["owner", "admin", "builder"].includes(user.role);
}

export function canOperate(user: AuthUser): boolean {
  return ["owner", "admin", "builder", "operator"].includes(user.role);
}

type TokenPayload = {
  typ: "runtime" | "delegation";
  orgId: string;
  runId: string;
  agentId: string;
  userId: string;
  scopes: string[];
};

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export async function signRuntimeToken(
  payload: Omit<TokenPayload, "typ">,
): Promise<string> {
  return new SignJWT({ ...payload, typ: "runtime" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .setAudience("workagent-runtime")
    .sign(jwtSecret());
}

export async function signDelegationToken(
  payload: Omit<TokenPayload, "typ">,
): Promise<string> {
  return new SignJWT({ ...payload, typ: "delegation" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .setAudience("workagent-tool")
    .sign(jwtSecret());
}

export async function verifyToken(
  token: string,
  audience: "workagent-runtime" | "workagent-tool",
): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { audience });
    return payload as unknown as TokenPayload;
  } catch {
    throw unauthorized("token 无效或已过期");
  }
}

export const PLATFORM_COOKIE = "wa_platform";
export async function platformLogin(
  email: string,
  password: string,
): Promise<string> {
  const user = await one<{ id: string; password_hash: string }>(
    "SELECT u.id,u.password_hash FROM app_user u JOIN platform_admin p ON p.user_id=u.id WHERE u.email=$1",
    [email.toLowerCase()],
  );
  if (!user || !(await verifyPassword(password, user.password_hash)))
    throw unauthorized("Invalid platform credentials");
  const token = randomToken(48);
  await tx(async (c) => {
    const grant = await c.query(
      "SELECT user_id FROM platform_admin WHERE user_id=$1 FOR SHARE",
      [user.id],
    );
    if (!grant.rowCount) throw unauthorized();
    await c.query(
      "INSERT INTO platform_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [sha256(token), user.id],
    );
    await c.query(
      "INSERT INTO platform_audit(user_id,action) VALUES($1,'platform.login')",
      [user.id],
    );
  });
  return token;
}
export async function getPlatformSessionUser(
  token: string | undefined,
): Promise<AuthUser | null> {
  if (!token) return null;
  const u = await one<{ id: string; email: string; name: string }>(
    "SELECT u.id,u.email,u.name FROM platform_session s JOIN platform_admin p ON p.user_id=s.user_id JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [sha256(token)],
  );
  return u
    ? { ...u, orgId: "", orgName: "", avatarUrl: null, role: "auditor" }
    : null;
}
