import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// Execute the actual loader in fresh processes with a relocated module tree.
// Every .env and cwd is a temporary fixture; no real ancestor .env is touched.
async function fixture() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workagent-env-"));
  const outer = path.join(temp, "outer");
  const root = path.join(outer, "workagent");
  const app = path.join(root, "apps", "api");
  const config = path.join(root, "packages", "config");
  const module = path.join(config, "src", "env.ts");
  await fs.mkdir(path.dirname(module), { recursive: true });
  await fs.mkdir(app, { recursive: true });
  await fs.copyFile(new URL("./env.ts", import.meta.url), module);
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await fs.symlink(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    path.join(config, "node_modules"),
    "dir",
  );
  function run(cwd: string, explicit?: string) {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        `const {loadEnv}=await import(${JSON.stringify(pathToFileURL(module).href)});loadEnv();console.log(JSON.stringify(process.env.WORKAGENT_ENV_TEST ?? null));`,
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          ...(explicit === undefined ? {} : { ENV_FILE: explicit }),
        },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout) as string | null;
  }
  return {
    temp,
    outer,
    root,
    app,
    run,
    cleanup: () => fs.rm(temp, { recursive: true, force: true }),
  };
}

test("missing workspace .env never falls back to parent or user-like ancestors", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.temp, ".env"),
      "WORKAGENT_ENV_TEST=user-scope\n",
    );
    await fs.writeFile(
      path.join(f.outer, ".env"),
      "WORKAGENT_ENV_TEST=outer-project\n",
    );
    assert.equal(f.run(f.root), null);
    assert.equal(f.run(f.app), null);
  } finally {
    await f.cleanup();
  }
});

test("app cwd loads module-anchored workspace .env, ignoring nearer app .env", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.root, ".env"),
      "WORKAGENT_ENV_TEST=workagent\n",
    );
    await fs.writeFile(
      path.join(f.app, ".env"),
      "WORKAGENT_ENV_TEST=app-local\n",
    );
    await fs.writeFile(
      path.join(f.outer, ".env"),
      "WORKAGENT_ENV_TEST=outer-project\n",
    );
    assert.equal(f.run(f.app), "workagent");
    assert.equal(f.run(f.root), "workagent");
  } finally {
    await f.cleanup();
  }
});

test("explicit absolute ENV_FILE can override the workspace location", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.root, ".env"),
      "WORKAGENT_ENV_TEST=workagent\n",
    );
    const explicit = path.join(f.outer, "selected.env");
    await fs.writeFile(explicit, "WORKAGENT_ENV_TEST=explicit\n");
    assert.equal(f.run(f.app, explicit), "explicit");
  } finally {
    await f.cleanup();
  }
});

test("explicit relative ENV_FILE retains cwd-relative behavior", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.root, ".env"),
      "WORKAGENT_ENV_TEST=workagent\n",
    );
    await fs.writeFile(
      path.join(f.app, "selected.env"),
      "WORKAGENT_ENV_TEST=relative\n",
    );
    assert.equal(f.run(f.app, "selected.env"), "relative");
  } finally {
    await f.cleanup();
  }
});

test("missing explicit ENV_FILE does not fall back to any default .env", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.root, ".env"),
      "WORKAGENT_ENV_TEST=workagent\n",
    );
    await fs.writeFile(
      path.join(f.outer, ".env"),
      "WORKAGENT_ENV_TEST=outer-project\n",
    );
    assert.equal(f.run(f.app, "missing.env"), null);
  } finally {
    await f.cleanup();
  }
});
