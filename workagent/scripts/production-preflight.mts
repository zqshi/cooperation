import { config } from "../packages/config/src/index.js";
import { pool, closePool } from "../packages/db/src/client.js";
import fs from "node:fs/promises";
if (!config.isProd) throw new Error("Preflight requires NODE_ENV=production");
try {
  const c = await pool.connect();
  try {
    await c.query("SELECT 1");
    const vector = await c.query(
      "SELECT extversion FROM pg_extension WHERE extname='vector'",
    );
    if (!vector.rowCount) throw new Error("pgvector missing");
    for (const file of (
      await fs.readdir(new URL("../packages/db/migrations/", import.meta.url))
    ).filter((f) => f.endsWith(".sql"))) {
      if (
        !(
          await c.query(
            "SELECT version FROM schema_migrations WHERE version=$1",
            [file],
          )
        ).rowCount
      )
        throw new Error(`Unapplied migration: ${file}`);
    }
    const { verifyPassword } = await import("../packages/core/src/crypto.js");
    let offset = 0;
    for (;;) {
      const users = await c.query<{ password_hash: string }>(
        "SELECT password_hash FROM app_user ORDER BY id LIMIT 100 OFFSET $1",
        [offset],
      );
      for (const user of users.rows)
        if (await verifyPassword("admin12345", user.password_hash))
          throw new Error(
            "Development default password exists; rotate before production",
          );
      if (users.rows.length < 100) break;
      offset += 100;
    }
    console.log(
      "Production configuration, database, pgvector and migrations verified; vendor connectivity, TLS/DNS and recovery drills require separate evidence.",
    );
  } finally {
    c.release();
  }
} finally {
  await closePool();
}
