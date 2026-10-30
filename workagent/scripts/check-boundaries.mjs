import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      ["node_modules", "dist", ".git"].includes(e.name)
        ? []
        : e.isDirectory()
          ? walk(path.join(dir, e.name))
          : [path.join(dir, e.name)],
    );
}
for (const file of [
  ...walk(path.join(root, "apps")),
  ...walk(path.join(root, "packages")),
].filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g,
  )) {
    const spec = match[1];
    if (spec.startsWith(".")) {
      const target = path.resolve(path.dirname(file), spec);
      const parts = path.relative(root, file).split(path.sep);
      const own = parts[0] === "apps" ? parts[1] : undefined;
      assert(
        !target.startsWith(path.join(root, "apps") + path.sep) ||
          (own !== undefined &&
            target.startsWith(path.join(root, "apps", own) + path.sep)),
        `Cross-app source import: ${file}: ${spec}`,
      );
    }
    assert(
      !/^@workagent\/(console|user-portal|admin|studio|workspace|collaboration)(\/|$)/.test(
        spec,
      ),
      `App package import: ${file}`,
    );
  }
}
for (const [app, port] of [
  ["console", 5173],
  ["user-portal", 5174],
]) {
  const config = fs.readFileSync(`apps/${app}/vite.config.ts`, "utf8");
  assert(
    config.includes(`port: ${port}`) && config.includes("strictPort: true"),
    `${app} port mismatch`,
  );
}
for (const file of walk(root).filter(
  (f) =>
    /\.(tsx?|jsx?|json|html|css|ya?ml|md)$/.test(f) &&
    !f.endsWith("pnpm-lock.yaml"),
)) {
  // Check obsolete brand identifiers without altering ordinary English words.
  if (file === path.join(root, "scripts/check-boundaries.mjs")) continue;
  const source = fs.readFileSync(file, "utf8");
  assert(
    !/\b(?:clawmate|kingsoft|king)\b/i.test(source),
    `Obsolete brand: ${path.relative(root, file)}`,
  );
}
console.log(
  "Source boundaries, two strict ports and independent brand checks passed",
);

for (const old of ["admin", "studio", "workspace", "collaboration"])
  assert(!fs.existsSync(`apps/${old}`), `Obsolete app: ${old}`);

const frontendApps = fs
  .readdirSync("apps")
  .filter((app) => fs.existsSync(`apps/${app}/index.html`))
  .sort();
assert.deepEqual(
  frontendApps,
  ["console", "user-portal"],
  "Only two frontend products are allowed",
);
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = fs.readFileSync("pnpm-lock.yaml", "utf8");
for (const app of frontendApps) {
  const pkg = JSON.parse(fs.readFileSync(`apps/${app}/package.json`, "utf8"));
  assert.equal(pkg.name, `@workagent/${app}`);
  assert.equal(
    manifest.scripts[`dev:${app}`],
    `pnpm --filter @workagent/${app} dev`,
  );
  assert(lock.includes(`  apps/${app}:`), `Missing lockfile importer: ${app}`);
}
for (const app of ["admin", "studio", "workspace", "collaboration"]) {
  assert(!manifest.scripts[`dev:${app}`], `Obsolete dev script: ${app}`);
  assert(
    !lock.includes(`  apps/${app}:`),
    `Obsolete lockfile importer: ${app}`,
  );
}
const configSource = fs.readFileSync("packages/config/src/index.ts", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");
for (const key of ["CONSOLE_ORIGIN", "USER_PORTAL_ORIGIN"]) {
  assert(
    configSource.includes(key) && envExample.includes(key),
    `Missing product origin: ${key}`,
  );
}
for (const key of [
  "ADMIN_ORIGIN",
  "WORKSPACE_ORIGIN",
  "STUDIO_ORIGIN",
  "COLLABORATION_ORIGIN",
]) {
  assert(
    !configSource.includes(key) && !envExample.includes(key),
    `Obsolete origin: ${key}`,
  );
}
console.log(
  "Two-product package, lockfile, script and environment checks passed",
);
