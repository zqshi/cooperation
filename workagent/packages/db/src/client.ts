import pg from "pg";
import { config } from "@workagent/config";

const { Pool, types } = pg;

types.setTypeParser(1184, (value: string) => new Date(value).toISOString());
types.setTypeParser(1114, (value: string) => new Date(`${value}Z`).toISOString());
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export type QueryParam = unknown;

export async function query<T = Record<string, unknown>>(
  text: string,
  params: QueryParam[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: QueryParam[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
