import { it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
it("real AWS SDK signs S3 put/get/delete against an isolated HTTP protocol fixture", async () => {
  let body = Buffer.alloc(0);
  const requests: { method: string; authorization: string }[] = [];
  const server = createServer(async (req, res) => {
    requests.push({
      method: req.method!,
      authorization: req.headers.authorization ?? "",
    });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    if (req.method === "PUT") {
      body = Buffer.concat(chunks);
      res.setHeader("etag", '"test"');
      res.end();
    } else if (req.method === "GET") {
      res.setHeader("content-length", body.length);
      res.end(body);
    } else {
      body = Buffer.alloc(0);
      res.writeHead(204).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const script = `const s=await import(${JSON.stringify(new URL("../../../packages/core/src/storage.ts", import.meta.url).href)});await s.putObject('org/file.txt',Buffer.from('S3 protocol fixture'),'text/plain');const b=await s.getObject('org/file.txt');if(b.toString()!=='S3 protocol fixture')throw new Error('S3 mismatch');await s.deleteObject('org/file.txt');`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          ENV_FILE: "/tmp/workagent-no-env",
          NODE_ENV: "test",
          USE_MOCK_MODEL: "false",
          STORAGE_DRIVER: "s3",
          S3_BUCKET: "workagent-test-fixture",
          S3_ENDPOINT: `http://127.0.0.1:${port}`,
          S3_REGION: "us-east-1",
          AWS_ACCESS_KEY_ID: "test-fixture-access",
          AWS_SECRET_ACCESS_KEY: "test-fixture-secret",
          AWS_EC2_METADATA_DISABLED: "true",
        },
      },
    );
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(code, err).toBe(0);
    expect(requests.map((r) => r.method)).toEqual(["PUT", "GET", "DELETE"]);
    expect(
      requests.every((r) => r.authorization.startsWith("AWS4-HMAC-SHA256")),
    ).toBe(true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 15000);
it("bounds a streaming S3 object without trusting Content-Length", async () => {
  const server = createServer((_req, res) => {
    const chunk = Buffer.alloc(1024 * 1024);
    let n = 0;
    const write = () => {
      while (n++ < 51) {
        if (!res.write(chunk)) {
          res.once("drain", write);
          return;
        }
      }
      res.end();
    };
    write();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const script = `const s=await import(${JSON.stringify(new URL("../../../packages/core/src/storage.ts", import.meta.url).href)});try{await s.getObject('org/oversized');process.exitCode=2;}catch(e){if(!String(e).includes('limit'))throw e;}`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          ENV_FILE: "/tmp/no-env",
          NODE_ENV: "test",
          STORAGE_DRIVER: "s3",
          S3_BUCKET: "fixture",
          S3_ENDPOINT: `http://127.0.0.1:${port}`,
          AWS_ACCESS_KEY_ID: "fixture",
          AWS_SECRET_ACCESS_KEY: "fixture",
          AWS_EC2_METADATA_DISABLED: "true",
        },
      },
    );
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    expect(
      await new Promise<number | null>((r) => child.on("close", r)),
      err,
    ).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 15000);
