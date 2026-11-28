import { Pool, type QueryResultRow } from "pg";

/**
 * PostgreSQL (pgvector) pool for docling-mcp. It holds only the encrypted secrets table
 * (service_secrets), shared with the other services in the agent database.
 *
 * Env (names only, set in env/.env.docling-mcp):
 *   AGENT_DATABASE_URL  postgres://<user>:<password>@pgvector:5432/<AGENT_DB>
 *   PG_POOL_MAX         optional, max connections per process (default 10)
 */

const globalForPg = globalThis as unknown as { __doclingPgPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__doclingPgPool) {
    const connectionString = process.env.AGENT_DATABASE_URL;
    if (!connectionString) throw new Error("AGENT_DATABASE_URL is not set");
    const pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) => console.error("pg pool: idle client error:", err.message));
    globalForPg.__doclingPgPool = pool;
  }
  return globalForPg.__doclingPgPool;
}

/** Run one statement on a pooled connection. Parameters use $1, $2, ... */
export function query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
  return getPool().query<T>(text, values);
}
