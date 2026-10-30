import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.env.STATIC_ROOT ?? "/app/public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  );
  if (req.url === "/healthz") {
    res.end("ok");
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (
      pathname.includes("\0") ||
      pathname.includes("\\") ||
      pathname.split("/").includes("..")
    ) {
      res.writeHead(400).end();
      return;
    }
    let file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(root + "/")) {
      res.writeHead(400).end();
      return;
    }
    let body;
    let ext = path.extname(file);
    try {
      if ((await realpath(file)) !== file) throw new Error("symlink");
      body = await readFile(file);
    } catch {
      if (ext) {
        res.writeHead(404).end();
        return;
      }
      file = root + "/index.html";
      if ((await realpath(file)) !== file) throw new Error();
      body = await readFile(file);
      ext = ".html";
    }
    res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
    res.setHeader("Content-Length", body.length);
    res.setHeader(
      "Cache-Control",
      ext === ".html" ? "no-cache" : "public,max-age=3600",
    );
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(400).end();
  }
}).listen(Number(process.env.STATIC_PORT ?? 8080), "0.0.0.0");
