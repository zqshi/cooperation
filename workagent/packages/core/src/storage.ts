import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { constants } from "node:fs";
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { config } from "@workagent/config";
import { badRequest } from "./errors.js";
const MAX_SIZE = 50 * 1024 * 1024;
const s3 = new S3Client({
  region: config.s3Region,
  ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
});
export function safeKey(key: string): string {
  if (
    !key ||
    key.includes("\\") ||
    key.includes("\0") ||
    path.posix.isAbsolute(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw badRequest("非法的存储路径");
  return key;
}
async function localPath(key: string, create = false): Promise<string> {
  const root = path.resolve(config.artifactDir);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.realpath(root)) !== root)
    throw badRequest("Symlink storage ancestor rejected");
  const rootStat = await fs.lstat(root);
  if (rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o022) !== 0)
    throw badRequest("Storage root must be owned and protected");
  if ((await fs.lstat(root)).isSymbolicLink())
    throw badRequest("Symlink storage root rejected");
  const parts = safeKey(key).split("/");
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    if (create)
      await fs.mkdir(dir, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "EEXIST") throw e;
      });
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw badRequest("Unsafe storage directory");
  }
  return path.join(dir, parts.at(-1)!);
}
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "file"
  );
}
export async function putObject(
  key: string,
  data: Buffer,
  mimeType = "application/octet-stream",
): Promise<{ key: string; size: number }> {
  const safe = safeKey(key);
  if (data.length > MAX_SIZE) throw badRequest("File exceeds 50 MiB");
  if (config.storageDriver === "s3") {
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: safe,
        Body: data,
        ContentType: mimeType,
        ServerSideEncryption: "AES256",
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
  } else {
    const file = await fs.open(
      await localPath(safe, true),
      constants.O_CREAT |
        constants.O_WRONLY |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(data);
    } finally {
      await file.close();
    }
  }
  return { key: safe, size: data.length };
}
export async function getObject(key: string): Promise<Buffer> {
  const safe = safeKey(key);
  if (config.storageDriver === "s3") {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: safe }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if ((result.ContentLength ?? 0) > MAX_SIZE)
      throw badRequest("File exceeds limit");
    if (!result.Body) throw new Error("Object body missing");
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > MAX_SIZE) throw badRequest("File exceeds limit");
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      (result.Body as { destroy?: () => void }).destroy?.();
    }
    return Buffer.concat(chunks);
  }
  const file = await fs.open(
    await localPath(safe),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    if ((await file.stat()).size > MAX_SIZE)
      throw badRequest("File exceeds limit");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function deleteObject(key: string): Promise<void> {
  const safe = safeKey(key);
  if (config.storageDriver === "s3")
    await s3.send(
      new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: safe }),
    );
  else await fs.rm(await localPath(safe), { force: true });
}
export function objectKey(prefix: string, name: string): string {
  return safeKey(`${prefix}/${crypto.randomUUID()}-${sanitizeFileName(name)}`);
}

let s3Cursor: string | undefined;
let localScan: AsyncGenerator<{ key: string; modified: Date }> | undefined;
async function* walkObjects(
  root: string,
  relative = "",
): AsyncGenerator<{ key: string; modified: Date }> {
  const dir = await fs.opendir(path.join(root, relative));
  for await (const entry of dir) {
    const key = relative ? relative + "/" + entry.name : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (key.split("/").length <= 12) yield* walkObjects(root, key);
    } else if (entry.isFile()) {
      const stat = await fs.lstat(path.join(root, key));
      yield { key, modified: stat.mtime };
    }
  }
}
/** Dedicated WorkAgent bucket/root only. Each pass examines at most 500 objects. */
export async function scanObjectBatch(): Promise<
  Array<{ key: string; modified: Date }>
> {
  if (config.storageDriver === "s3") {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.s3Bucket,
        MaxKeys: 500,
        ContinuationToken: s3Cursor,
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    s3Cursor = result.NextContinuationToken;
    return (result.Contents ?? [])
      .filter((o) => o.Key && o.LastModified)
      .map((o) => ({ key: o.Key!, modified: o.LastModified! }));
  }
  const root = path.resolve(config.artifactDir);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.realpath(root)) !== root)
    throw badRequest("Symlink storage root rejected");
  const stat = await fs.lstat(root);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)
    throw badRequest("Storage root must be owned and protected");
  localScan ??= walkObjects(root);
  const result: Array<{ key: string; modified: Date }> = [];
  for (let i = 0; i < 500; i++) {
    const next = await localScan.next();
    if (next.done) {
      localScan = undefined;
      break;
    }
    result.push(next.value);
  }
  return result;
}
