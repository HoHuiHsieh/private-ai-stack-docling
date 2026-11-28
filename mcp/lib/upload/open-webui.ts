import type { ExtractedImage } from "../docling/images";
import { readSecretFile, requireEnv, UploadError, UPLOAD_TIMEOUT_MS } from "./common";

/**
 * Upload an image to Open WebUI's file store (POST /api/v1/files/). Returns the file id.
 * Files are owned by the API key's user, not the caller.
 *
 * Env (names only, set in env/.env.docling-mcp):
 *   OPEN_WEBUI_URL            internal base URL, e.g. http://open-webui:8080 (backend network)
 *   OPEN_WEBUI_API_KEY_FILE   path to the API key secret, default /run/secrets/open_webui_api_key
 *                             (the Compose secret, not an env value)
 */
export async function uploadToOpenWebUI(image: ExtractedImage): Promise<string> {
  const base = requireEnv("OPEN_WEBUI_URL");
  const key = await readSecretFile("OPEN_WEBUI_API_KEY_FILE", "/run/secrets/open_webui_api_key", "Open WebUI API key");

  const buffer = new ArrayBuffer(image.bytes.length);
  new Uint8Array(buffer).set(image.bytes);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: image.mime }), image.name);

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/files/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new UploadError("Cannot reach Open WebUI to upload the image.");
  }
  if (!res.ok) throw new UploadError(`Open WebUI returned HTTP ${res.status} for the image upload.`);

  const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!data || typeof data.id !== "string") throw new UploadError("Unexpected upload response from Open WebUI.");
  return data.id;
}
