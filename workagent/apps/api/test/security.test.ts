import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { config, validateProductionConfig } from "@workagent/config";
import { publicAddress } from "../../../packages/core/src/network.js";
import { safeKey } from "../../../packages/core/src/storage.js";
import {
  verifyFeishuSignature,
  verifyDingTalkSignature,
} from "@workagent/core";
const secret = () => randomBytes(48).toString("base64url");
function production() {
  return {
    ...config,
    nodeEnv: "production",
    isProd: true,
    jwtSecret: secret(),
    encryptionKey: secret(),
    apiUrl: "https://api.example.com",
    consoleOrigin: "https://console.example.com",
    userPortalOrigin: "https://portal.example.com",
    modelApiKey: secret(),
    useMockModel: false,
  };
}
describe("production fail-closed policy", () => {
  it("accepts distinct generated secrets and HTTPS configuration", () =>
    expect(() => validateProductionConfig(production())).not.toThrow());
  it.each(["jwtSecret", "encryptionKey"] as const)("rejects weak %s", (key) =>
    expect(() =>
      validateProductionConfig({ ...production(), [key]: "dev-secret" }),
    ).toThrow(),
  );
  it("rejects mock and plaintext model", () => {
    expect(() =>
      validateProductionConfig({ ...production(), useMockModel: true }),
    ).toThrow();
    expect(() =>
      validateProductionConfig({
        ...production(),
        modelBaseUrl: "http://model.example.com",
      }),
    ).toThrow();
  });
  it("accepts independently generated hex and base64 secrets repeatedly", () => {
    for (let i = 0; i < 100; i++)
      expect(() =>
        validateProductionConfig({
          ...production(),
          jwtSecret: randomBytes(32).toString("hex"),
          encryptionKey: randomBytes(32).toString("base64url"),
        }),
      ).not.toThrow();
  });
  it("rejects reused secrets", () => {
    const p = production();
    p.jwtSecret = p.encryptionKey;
    expect(() => validateProductionConfig(p)).toThrow();
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("rejects private address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it("allows public addresses", () =>
    expect(publicAddress("8.8.8.8")).toBe(true));
  it.each([
    "../secret",
    "a/../b",
    "/etc/passwd",
    "a\\b",
    "a//b",
    "a/./b",
    "a\0b",
  ])("rejects unsafe storage key %s", (key) =>
    expect(() => safeKey(key)).toThrow(),
  );
  it("rejects missing channel signatures", () => {
    expect(
      verifyFeishuSignature({ headers: {}, rawBody: "{}", body: {} }),
    ).toBe(false);
    expect(verifyDingTalkSignature({})).toBe(false);
  });
  it("rejects old signed events", () =>
    expect(
      verifyDingTalkSignature({
        timestamp: "1",
        sign: "bad",
        appSecret: "secret",
      }),
    ).toBe(false));
});

describe("review parser, schema and password regressions", () => {
  it("validates nested schema constraints, formats, additional properties and safe patterns", async () => {
    const { validateInput } = await import("@workagent/core");
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          items: { type: "integer", minimum: 2 },
        },
        email: { type: "string", format: "email" },
      },
      required: ["items", "email"],
      additionalProperties: false,
    };
    expect(() =>
      validateInput(schema, { items: [2], email: "valid@test.local" }),
    ).not.toThrow();
    for (const bad of [
      { items: [1], email: "valid@test.local" },
      { items: [], email: "valid@test.local" },
      { items: [2], email: "bad" },
      { items: [2], email: "valid@test.local", extra: true },
    ])
      expect(() => validateInput(schema, bad)).toThrow();
    expect(() =>
      validateInput(
        {
          type: "object",
          properties: { x: { type: "string", pattern: "^(a+)+$" } },
        },
        { x: "a".repeat(50000) + "!" },
      ),
    ).toThrow();
  });
  it("canonicalizes nested argument key order and rejects non-JSON/overlong passwords", async () => {
    const { stableChecksum, hashPassword, verifyPassword } =
      await import("@workagent/core");
    expect(stableChecksum({ b: { z: 1, a: 2 }, a: 3 })).toBe(
      stableChecksum({ a: 3, b: { a: 2, z: 1 } }),
    );
    expect(() => stableChecksum({ x: NaN })).toThrow();
    await expect(hashPassword("密".repeat(25))).rejects.toThrow();
    const hash = await hashPassword("密".repeat(24));
    expect(await verifyPassword("密".repeat(25), hash)).toBe(false);
  });
  it("strips HTML before text handling and rejects mismatched PDF/DOCX magic safely", async () => {
    const { extractText } = await import("@workagent/core");
    expect(
      await extractText(
        Buffer.from("<script>secret()</script><p>Hello</p>"),
        "text/html",
        "page.html",
      ),
    ).toBe("Hello");
    await expect(
      extractText(Buffer.from("not a PDF"), "application/pdf", "a.pdf"),
    ).rejects.toThrow();
    await expect(
      extractText(
        Buffer.from("not a DOCX"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).rejects.toThrow();
  });
  it("uses linear-time eval expressions and nested JSON Schema assertions", async () => {
    const { checkAssertions, validateAssertions } =
      await import("@workagent/core");
    expect(
      checkAssertions(
        "a".repeat(100000) + "!",
        [],
        [{ type: "regex", value: "^(a+)+$" }],
      ),
    ).toHaveLength(1);
    expect(() =>
      validateAssertions([{ type: "regex", value: "(?=unsupported)" }]),
    ).toThrow();
    expect(
      checkAssertions(
        '{"a":1}',
        [],
        [
          {
            type: "json_schema",
            value: JSON.stringify({
              type: "object",
              properties: { a: { type: "integer", minimum: 2 } },
              required: ["a"],
            }),
          },
        ],
      ),
    ).toHaveLength(1);
  });
});
it("rejects a small compressed archive bomb and parses a valid DOCX in the bounded child process", async () => {
  const fs = await import("node:fs/promises");
  const { extractText } = await import("@workagent/core");
  const mime =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  await expect(
    extractText(
      await fs.readFile(
        new URL(
          "../../../tests/fixtures/bounded-docx-bomb.docx",
          import.meta.url,
        ),
      ),
      mime,
      "bomb.docx",
    ),
  ).rejects.toThrow();
  expect(
    await extractText(
      await fs.readFile(
        new URL("../../../tests/fixtures/small.docx", import.meta.url),
      ),
      mime,
      "small.docx",
    ),
  ).toContain("Bounded parser fixture");
});
it("real model HTTP client rejects malformed vectors/calls/usage, redacts provider errors and honors aborts", async () => {
  const { createServer } = await import("node:http");
  const core = await import("@workagent/core");
  const { agentDefinitionSchema } = await import("@workagent/contracts");
  const { config } = await import("@workagent/config");
  const mutable = config as unknown as {
    useMockModel: boolean;
    modelApiKey: string;
    modelBaseUrl: string;
  };
  const saved = {
    useMockModel: mutable.useMockModel,
    modelApiKey: mutable.modelApiKey,
    modelBaseUrl: mutable.modelBaseUrl,
  };
  let mode = "order";
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    res.setHeader("content-type", "application/json");
    if (mode === "error") {
      res.writeHead(500).end('{"secret":"vendor-private-secret"}');
      return;
    }
    if (mode === "slow") return;
    if (req.url?.endsWith("/embeddings")) {
      res.end(
        JSON.stringify({
          data:
            mode === "dimension"
              ? [{ index: 0, embedding: [1, 2] }]
              : [
                  { index: 1, embedding: Array(1536).fill(2) },
                  { index: 0, embedding: Array(1536).fill(1) },
                ],
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            message:
              mode === "call"
                ? {
                    tool_calls: [
                      {
                        id: "bad",
                        type: "function",
                        function: { name: "unknown", arguments: "invalid" },
                      },
                    ],
                  }
                : { content: "ok" },
          },
        ],
        usage: {
          prompt_tokens: mode === "usage" ? -1 : 1,
          completion_tokens: 1,
        },
      }),
    );
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  try {
    Object.assign(mutable, {
      useMockModel: false,
      modelApiKey: "fixture",
      modelBaseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
    });
    const vectors = await core.embedTexts(["a", "b"]);
    expect(vectors[0]![0]).toBe(1);
    expect(vectors[1]![0]).toBe(2);
    mode = "dimension";
    await expect(core.embedTexts(["a"])).rejects.toMatchObject({
      code: "embedding_error",
    });
    const input = {
      definition: agentDefinitionSchema.parse({
        name: "Fixture",
        instructions: "Fixture",
      }),
      messages: [{ role: "user" as const, content: "hello" }],
      tools: [],
    };
    mode = "error";
    await expect(core.chatCompletion(input)).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("vendor-private-secret"),
    );
    for (const bad of ["call", "usage"]) {
      mode = bad;
      await expect(core.chatCompletion(input)).rejects.toMatchObject({
        code: "model_error",
      });
    }
    mode = "slow";
    await expect(
      core.chatCompletion({ ...input, signal: AbortSignal.timeout(30) }),
    ).rejects.toThrow();
  } finally {
    Object.assign(mutable, saved);
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}, 5000);
