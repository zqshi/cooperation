import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";
import { badRequest } from "./errors.js";
export async function inspectDocx(buffer: Buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50)
    throw badRequest("DOCX magic mismatch");
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(badRequest("Invalid DOCX archive"));
      let size = 0,
        count = 0,
        document = false;
      const fail = () => {
        zip.close();
        reject(badRequest("DOCX archive exceeds safe bounds"));
      };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        size += entry.uncompressedSize;
        count++;
        if (
          size > 20 * 1024 * 1024 ||
          count > 2000 ||
          entry.uncompressedSize > 8 * 1024 * 1024 ||
          entry.generalPurposeBitFlag & 1 ||
          entry.fileName.split("/").includes("..") ||
          (entry.uncompressedSize > 1024 * 1024 &&
            entry.uncompressedSize / Math.max(1, entry.compressedSize) > 100)
        )
          return fail();
        if (entry.fileName === "word/document.xml") document = true;
        zip.readEntry();
      });
      zip.on("end", () =>
        document ? resolve() : reject(badRequest("Not a DOCX document")),
      );
      zip.readEntry();
    });
  });
}
export async function parseDocument(
  buffer: Buffer,
  kind: "pdf" | "docx",
): Promise<string> {
  if (buffer.length > 50 * 1024 * 1024 || buffer.length < 4)
    throw badRequest("Invalid document size");
  if (kind === "pdf" && !buffer.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw badRequest("PDF magic mismatch");
  if (kind === "docx") await inspectDocx(buffer);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=128",
        fileURLToPath(new URL("./document-parser.mjs", import.meta.url)),
        kind,
      ],
      { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH } },
    );
    let done = false,
      size = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(
      () => finish(badRequest("Document parser timed out")),
      10000,
    );
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 4 * 1024 * 1024)
        finish(badRequest("Parsed document too large"));
      else chunks.push(c);
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => finish(badRequest("Document parser unavailable")));
    child.on("close", (code) =>
      finish(
        code === 0 ? undefined : badRequest("Document parsing failed safely"),
      ),
    );
    child.stdin.end(buffer);
  });
}
