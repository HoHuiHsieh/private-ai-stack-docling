import type { ExtractedImage } from "../docling/images";
import { requireEnv, UploadError, UPLOAD_TIMEOUT_MS } from "./common";

/**
 * Upload an image to Open WebUI's file store (POST /api/v1/files/). Returns the file id.
 * The file belongs to the owner of apiKey, which is the caller's stored Open WebUI key.
 *
 * Env (names only, set in env/.env.docling-mcp):
 *   OPEN_WEBUI_URL   internal base URL, e.g. http://open-webui:8080 (backend network)
 */
export async function uploadToOpenWebUI(image: ExtractedImage, apiKey: string): Promise<string> {
  const base = requireEnv("OPEN_WEBUI_URL");

  const buffer = new ArrayBuffer(image.bytes.length);
  new Uint8Array(buffer).set(image.bytes);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: image.mime }), image.name);

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/files/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
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
