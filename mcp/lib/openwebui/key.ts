import { getSecret, getSecretMeta, setSecret } from "../secrets/store";

/**
 * The caller's Open WebUI API key, stored encrypted per user (the Keycloak sub) through the
 * docling_set_open_webui_key secure form. Image uploads to Open WebUI use it, so files belong to the
 * caller. The value is never returned to a model or logged.
 */

export const OPEN_WEBUI_SERVICE = "docling";
export const OPEN_WEBUI_KEY_SECRET = "open_webui_api_key";

export function getOpenWebUIKey(sub: string): Promise<string | null> {
  return getSecret(sub, OPEN_WEBUI_SERVICE, OPEN_WEBUI_KEY_SECRET);
}

export function setOpenWebUIKey(sub: string, apiKey: string): Promise<void> {
  return setSecret(sub, OPEN_WEBUI_SERVICE, OPEN_WEBUI_KEY_SECRET, apiKey);
}

export function getOpenWebUIKeyMeta(sub: string) {
  return getSecretMeta(sub, OPEN_WEBUI_SERVICE, OPEN_WEBUI_KEY_SECRET);
}
