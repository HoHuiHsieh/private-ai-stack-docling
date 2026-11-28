import type { ExtractedImage } from "../docling/images";
import { requireEnv, UploadError, UPLOAD_TIMEOUT_MS } from "./common";

/**
 * Upload an image into Open Terminal: POST /files/upload?directory=... (multipart field "file").
 * The terminal runs in multi-user mode, so the caller's Open WebUI user id goes in X-User-Id and the
 * file lands in that user's workspace. Returns the stored path reported by the terminal.
 *
 * Env (names only, set in env/.env.docling-mcp):
 *   OPEN_TERMINAL_URL       base URL, e.g. http://open-terminal:8000 (backend network)
 *   OPEN_TERMINAL_API_KEY   the key set on the open-terminal container (Bearer auth)
 */
export type TerminalTarget = { directory: string; userId: string };

export async function uploadToOpenTerminal(image: ExtractedImage, target: TerminalTarget): Promise<string> {
  const base = requireEnv("OPEN_TERMINAL_URL");
  const key = requireEnv("OPEN_TERMINAL_API_KEY");

  const buffer = new ArrayBuffer(image.bytes.length);
  new Uint8Array(buffer).set(image.bytes);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: image.mime }), image.name);

  let res: Response;
  try {
    res = await fetch(`${base}/files/upload?directory=${encodeURIComponent(target.directory)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "X-User-Id": target.userId,
        Accept: "application/json",
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new UploadError("Cannot reach Open Terminal to upload the image.");
  }
  if (!res.ok) throw new UploadError(`Open Terminal returned HTTP ${res.status} for the image upload.`);

  const data = (await res.json().catch(() => null)) as { path?: unknown } | null;
  if (!data || typeof data.path !== "string") throw new UploadError("Unexpected upload response from Open Terminal.");
  return data.path;
}
