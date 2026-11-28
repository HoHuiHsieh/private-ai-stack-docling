import { query } from "../db/pool";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Per-user secrets in the shared service_secrets table (the agent database). Each row is owned by
 * one user (the Keycloak `sub`) and one service. Every lookup filters on the owner, so one user never
 * reads another user's secret. Values are encrypted with SECRETS_ENCRYPTION_KEY.
 *
 * Callers must never return a value to a model or log it. getSecretMeta reports status only.
 * The table layout matches docgen's, so the two services can share the table.
 */

export type SecretMeta = { updatedAt: string; updatedBy: string; createdBy: string };

let tableReady: Promise<void> | null = null;

/** Creates the table on first use. Safe to call repeatedly. */
export function ensureSecretsTable(): Promise<void> {
  if (!tableReady) {
    tableReady = query(
      `CREATE TABLE IF NOT EXISTS service_secrets (
         owner      text        NOT NULL,
         service    text        NOT NULL,
         name       text        NOT NULL,
         ciphertext text        NOT NULL,
         updated_by text        NOT NULL,
         created_by text        NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (owner, service, name)
       );`,
    ).then(
      () => undefined,
      (err) => {
        tableReady = null; // retry on the next call
        throw err;
      },
    );
  }
  return tableReady;
}

/** Stores or replaces the owner's secret. */
export async function setSecret(owner: string, service: string, name: string, value: string): Promise<void> {
  await ensureSecretsTable();
  await query(
    `INSERT INTO service_secrets (owner, service, name, ciphertext, updated_by, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $1, $1, now())
     ON CONFLICT (owner, service, name)
     DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [owner, service, name, encryptSecret(value)],
  );
}

/** The owner's decrypted secret, or null if none is stored. */
export async function getSecret(owner: string, service: string, name: string): Promise<string | null> {
  await ensureSecretsTable();
  const res = await query<{ ciphertext: string }>(
    "SELECT ciphertext FROM service_secrets WHERE owner = $1 AND service = $2 AND name = $3",
    [owner, service, name],
  );
  const row = res.rows[0];
  return row ? decryptSecret(row.ciphertext) : null;
}

/** Status only: never includes the value. */
export async function getSecretMeta(owner: string, service: string, name: string): Promise<SecretMeta | null> {
  await ensureSecretsTable();
  const res = await query<{ updated_at: Date; updated_by: string; created_by: string }>(
    "SELECT updated_at, updated_by, created_by FROM service_secrets WHERE owner = $1 AND service = $2 AND name = $3",
    [owner, service, name],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by, createdBy: row.created_by };
}
