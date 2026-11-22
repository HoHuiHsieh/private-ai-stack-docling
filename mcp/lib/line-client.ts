/**
 * Client for the line service's internal API (services/line). The LINE bridge, its credentials, and the
 * Open WebUI connection live there. agent-service only calls it.
 *
 * Env (names only, set in env/.env.agent-service):
 *   LINE_SERVICE_URL     base URL, default http://line:3000 (backend network)
 *   INTERNAL_API_TOKEN   shared secret, must equal INTERNAL_API_TOKEN in env/.env.line
 */

const DEFAULT_URL = "http://line:3000";

type LineFetchOptions = {
  method: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
};

/** Throws when INTERNAL_API_TOKEN is not set, so callers can treat LINE as not configured. */
export async function lineFetch(path: string, opts: LineFetchOptions): Promise<Response> {
  const base = (process.env.LINE_SERVICE_URL?.trim() || DEFAULT_URL).replace(/\/$/, "");
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) throw new Error("INTERNAL_API_TOKEN is not set");

  const headers: Record<string, string> = { "x-internal-token": token };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(`${base}${path}`, {
    method: opts.method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
}

/** Reads the {error} field of a line-service response, for logs and the reminder's failure reason. */
export async function lineErrorText(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    // fall through
  }
  return `HTTP ${res.status}`;
}
