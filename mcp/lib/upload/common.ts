import { readFile } from "node:fs/promises";

/** Error text here is safe to return to the model. */
export class UploadError extends Error {}

export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * A secret read from a file, e.g. a Compose secret mounted at /run/secrets/<name>.
 * envName holds the file path (not the secret); fallbackPath is used when it is unset.
 * The value is never logged or put in an error.
 */
export async function readSecretFile(envName: string, fallbackPath: string, label: string): Promise<string> {
  const path = process.env[envName]?.trim() || fallbackPath;
  try {
    const value = (await readFile(path, "utf8")).trim();
    if (value) return value;
  } catch {
    // fall through to the error below
  }
  throw new UploadError(`${label} is missing or empty (read from the secret file named by ${envName}).`);
}

/** A required setting from env. Throws an UploadError naming the variable, never its value. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new UploadError(`${name} is not set, so images cannot be uploaded there.`);
  return value.replace(/\/$/, "");
}
