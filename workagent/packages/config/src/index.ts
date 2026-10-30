import { z } from "zod";
import { loadEnv } from "./env.js";
export { loadEnv } from "./env.js";

loadEnv();

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}
function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  return Number(raw);
}
function bool(key: string, fallback = false): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  if (!["0", "1", "true", "false"].includes(raw.toLowerCase()))
    throw new Error(`Invalid boolean configuration: ${key}`);
  return raw === "1" || raw.toLowerCase() === "true";
}

const values = {
  nodeEnv: str("NODE_ENV", "development"),
  isProd: str("NODE_ENV", "development") === "production",
  databaseUrl: str(
    "DATABASE_URL",
    "postgres://workagent:workagent@localhost:5432/workagent",
  ),
  jwtSecret: str("JWT_SECRET", "dev-jwt-secret"),
  encryptionKey: str("ENCRYPTION_KEY", "dev-encryption-key-32-bytes!!!"),
  trustedProxy: str("TRUSTED_PROXY", ""),
  toolAllowedHosts: str("TOOL_ALLOWED_HOSTS", ""),
  s3Bucket: str("S3_BUCKET"),
  s3Region: str("S3_REGION", "us-east-1"),
  s3Endpoint: str("S3_ENDPOINT"),
  apiPort: int("API_PORT", 4100),
  internalApiUrl: str(
    "INTERNAL_API_URL",
    process.env.NODE_ENV === "production"
      ? "http://api:4100"
      : str("API_URL", "http://localhost:4100"),
  ),
  apiUrl: str("API_URL", "http://localhost:4100"),
  consoleOrigin: str("CONSOLE_ORIGIN", "http://localhost:5173"),
  userPortalOrigin: str("USER_PORTAL_ORIGIN", "http://localhost:5174"),
  retentionDays: int("RETENTION_DAYS", 90),
  workerConcurrency: int("WORKER_CONCURRENCY", 2),
  channelPort: int("CHANNEL_PORT", 4101),
  modelBaseUrl: str("MODEL_BASE_URL", "https://api.openai.com/v1"),
  modelApiKey: str("MODEL_API_KEY", ""),
  modelName: str("MODEL_NAME", "gpt-4o-mini"),
  embeddingModel: str("EMBEDDING_MODEL", "text-embedding-3-small"),
  embeddingDim: int("EMBEDDING_DIM", 1536),
  storageDriver: str("STORAGE_DRIVER", "local") as "local" | "s3",
  artifactDir: str("ARTIFACT_DIR", "./data/artifacts"),
  seedAdminEmail: str("SEED_ADMIN_EMAIL", "admin@workagent.local"),
  seedAdminPassword: str("SEED_ADMIN_PASSWORD", "admin12345"),
  seedOrgName: str("SEED_ORG_NAME", "WorkAgent Demo"),
  feishuAppId: str("FEISHU_APP_ID"),
  feishuAppSecret: str("FEISHU_APP_SECRET"),
  feishuVerificationToken: str("FEISHU_VERIFICATION_TOKEN"),
  feishuEncryptKey: str("FEISHU_ENCRYPT_KEY"),
  dingtalkClientId: str("DINGTALK_CLIENT_ID"),
  dingtalkClientSecret: str("DINGTALK_CLIENT_SECRET"),
  dingtalkRobotCode: str("DINGTALK_ROBOT_CODE"),
  useMockModel: str("NODE_ENV") === "test" && bool("USE_MOCK_MODEL", false),
} as const;

export type AppConfig = typeof config;

const strongSecret = z
  .string()
  .min(43)
  .refine(
    (v) =>
      ((/^[a-f0-9]{64,}$/i.test(v) && v.length % 2 === 0) ||
        (/^[A-Za-z0-9_+/=-]{43,}$/.test(v) &&
          Buffer.from(v, "base64url").length >= 32)) &&
      new Set(v).size >= 8 &&
      !/dev-|default|changeme/i.test(v),
    "must be a randomly generated secret",
  );
const httpsUrl = z
  .string()
  .url()
  .refine(
    (v) =>
      new URL(v).protocol === "https:" &&
      !new URL(v).username &&
      !new URL(v).password,
    "HTTPS required",
  );
export function validateProductionConfig(value: typeof values): void {
  z.object({
    nodeEnv: z.enum(["development", "test", "production"]),
    storageDriver: z.enum(["local", "s3"]),
    apiPort: z.number().int().min(1).max(65535),
    channelPort: z.number().int().min(1).max(65535),
    workerConcurrency: z.number().int().min(1).max(16),
    embeddingDim: z.literal(1536),
    retentionDays: z.number().int().min(7).max(3650),
  }).parse(value);
  if (
    process.env.USE_MOCK_MODEL &&
    process.env.USE_MOCK_MODEL !== "false" &&
    process.env.USE_MOCK_MODEL !== "0" &&
    value.nodeEnv !== "test"
  )
    throw new Error("Mock provider is restricted to tests");
  if (!value.isProd) return;
  z.object({
    jwtSecret: strongSecret,
    encryptionKey: strongSecret,
    databaseUrl: z
      .string()
      .url()
      .refine((v) =>
        ["postgres:", "postgresql:"].includes(new URL(v).protocol),
      ),
    apiUrl: httpsUrl,
    consoleOrigin: httpsUrl,
    userPortalOrigin: httpsUrl,
    modelBaseUrl: httpsUrl,
    modelApiKey: z.string().min(16),
    modelName: z.string().min(1),
    useMockModel: z.literal(false),
  }).parse(value);
  if (new Set([value.jwtSecret, value.encryptionKey]).size !== 2)
    throw new Error("Production secrets must be distinct");
  if (value.consoleOrigin === value.userPortalOrigin)
    throw new Error("Product origins must be distinct");
  if (value.storageDriver === "s3") z.string().min(3).parse(value.s3Bucket);
  if (value.s3Endpoint) httpsUrl.parse(value.s3Endpoint);
  if (
    ["SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "SEED_ORG_NAME"].some(
      (k) => process.env[k],
    )
  )
    throw new Error("Production seed configuration is forbidden");
}
validateProductionConfig(values);
export const config = values;
