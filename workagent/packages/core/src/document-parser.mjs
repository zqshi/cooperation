// Disposable process: bounded heap, parent-enforced wall time/output and input size.
import mammoth from "mammoth";
import pdf from "pdf-parse/lib/pdf-parse.js";
const chunks = [];
let size = 0;
for await (const c of process.stdin) {
  size += c.length;
  if (size > 50 * 1024 * 1024) process.exit(2);
  chunks.push(c);
}
try {
  const buffer = Buffer.concat(chunks);
  const text =
    process.argv[2] === "pdf"
      ? (await pdf(buffer)).text
      : (await mammoth.extractRawText({ buffer })).value;
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) process.exit(2);
  process.stdout.write(text);
} catch {
  process.exit(2);
}
