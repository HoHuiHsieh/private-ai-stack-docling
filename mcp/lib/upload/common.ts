/** Error text here is safe to return to the model. */
export class UploadError extends Error {}

export const UPLOAD_TIMEOUT_MS = 60_000;

/** A required setting from env. Throws an UploadError naming the variable, never its value. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new UploadError(`${name} is not set, so images cannot be uploaded there.`);
  return value.replace(/\/$/, "");
}
