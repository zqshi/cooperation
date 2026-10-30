import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "@workagent/config";

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, "utf8") > 72)
    throw new Error("Password exceeds 72 UTF-8 bytes");
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > 72) return false;
  return bcrypt.compare(password, hash);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function stableChecksum(value: unknown): string {
  let nodes = 0;
  const canonical = (v: unknown, depth = 0): unknown => {
    if (++nodes > 100000 || depth > 64)
      throw new Error("JSON input too complex");
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map((x) => canonical(x, depth + 1));
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    )
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [
            k,
            canonical((v as Record<string, unknown>)[k], depth + 1),
          ]),
      );
    throw new Error("Unsupported JSON value");
  };
  const raw = JSON.stringify(canonical(value));
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw new Error("JSON input too large");
  return sha256(raw);
}

function encryptionKey(): Buffer {
  return crypto.createHash("sha256").update(config.encryptionKey).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, dataRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) {
    throw new Error("invalid encrypted secret");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
