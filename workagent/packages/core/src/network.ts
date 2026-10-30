import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as request } from "undici";
import { config } from "@workagent/config";
import { badRequest } from "./errors.js";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 198
    );
  }
  // Restrict IPv6 to global unicast, excluding embedded IPv4 and special ranges.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !address.toLowerCase().startsWith("2001:")
  );
}

/** Exact host allowlist plus DNS validation in the connection lookup prevents rebinding. */
export async function toolFetch(
  raw: string,
  init: Parameters<typeof request>[1] = {},
) {
  const url = new URL(raw);
  const allowed = config.toolAllowedHosts
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const testLoopback =
    config.nodeEnv === "test" &&
    process.env.TEST_TOOL_LOOPBACK === "1" &&
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.protocol === "http:";
  if (
    !testLoopback &&
    (url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowed.includes(url.hostname) ||
      (url.port && url.port !== "443"))
  )
    throw badRequest("Tool destination is not allowed");
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (!testLoopback && isIP(literal) && !publicAddress(literal))
    throw badRequest("Private tool destination rejected");
  const dispatcher = new Agent({
    connect: {
      autoSelectFamily: false,
      lookup: (hostname, _options, callback) => {
        void lookup(hostname, { all: true })
          .then((records) => {
            if (
              !records.length ||
              records.some((r) => !publicAddress(r.address))
            )
              throw badRequest("Private tool destination rejected");
            const r = records[0]!;
            callback(null, r.address, r.family);
          })
          .catch((error) => callback(error, "", 4));
      },
    },
  });
  try {
    const response = await request(url, {
      ...init,
      ...(testLoopback ? {} : { dispatcher }),
      redirect: "error",
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const isSse = (response.headers.get("content-type") ?? "").includes(
      "text/event-stream",
    );
    let expected: unknown;
    if (isSse && typeof init?.body === "string") {
      try {
        expected = JSON.parse(init.body).id;
      } catch {}
    }
    const decoder = new TextDecoder();
    let pending = "";
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw badRequest("Tool response too large");
        }
        if (isSse) {
          pending += decoder
            .decode(value, { stream: true })
            .replace(/\r\n/g, "\n");
          let split: number;
          while ((split = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, split);
            pending = pending.slice(split + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (
              expected !== undefined &&
              parsed.id === expected &&
              ("result" in parsed || "error" in parsed)
            ) {
              await reader.cancel();
              return new Response(JSON.stringify(parsed), {
                status: response.status,
                headers: {
                  ...Object.fromEntries(response.headers),
                  "content-type": "application/json",
                },
              });
            }
          }
        } else chunks.push(value);
      }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  } finally {
    await dispatcher.close();
  }
}
