// Deliberately limited to the explicitly authorized existing development database.
import fs from "node:fs/promises";
import { config } from "../packages/config/src/index.js";
import { pool, closePool } from "../packages/db/src/client.js";
const url = new URL(config.databaseUrl);
if (
  url.pathname !== "/workagent_local" ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("Refusing non-local development database");
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(78009411)");
  const file = "012_personal_assistant.sql";
  const applied = await c.query(
    "SELECT version FROM schema_migrations WHERE version=$1",
    [file],
  );
  if (!applied.rowCount) {
    const previous = await c.query(
      "SELECT version FROM schema_migrations WHERE version='011_platform_lifecycle.sql'",
    );
    if (!previous.rowCount)
      throw new Error("Expected existing development migration 011");
    await c.query(
      await fs.readFile(
        new URL(`../packages/db/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
    await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [file]);
    console.log(
      "Applied additive migration 012 to workagent_local; no seed or existing-row updates",
    );
  } else console.log("Migration 012 already applied to workagent_local");
  await c.query("COMMIT");
} catch (error) {
  await c.query("ROLLBACK");
  throw error;
} finally {
  c.release();
  await closePool();
}
