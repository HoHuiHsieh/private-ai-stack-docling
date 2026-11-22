/**
 * Docling Serve client (port of _mcp/docling/_base DoclingClient), stateless.
 * Talks to the docling-serve container over the backend network.
 *
 * Env (names only):
 *   DOCLING_API_URL          base URL, e.g. http://docling:5001
 *   DOCLING_TIMEOUT_SECONDS  per-request timeout, default 300 (conversions can be slow)
 */

/** Error text here is safe to return to the model. */
export class DoclingError extends Error {}

export type ConversionOptions = {
  doOcr?: boolean;
  pageRange?: [number, number];
  tableMode?: "fast" | "accurate";
};

export type DocumentResult = {
  status: string | null;
  processingTime: number | null;
  errors: unknown[];
  filename: string | null;
  markdown: string;
};

export type TaskInfo = {
  taskId: string;
  taskStatus: string;
  taskPosition: number | null;
};

export const TERMINAL_STATUSES = new Set(["success", "partial_success", "failure", "skipped"]);

function settings(): { baseUrl: string; timeoutMs: number } {
  const baseUrl = (process.env.DOCLING_API_URL || "").replace(/\/$/, "");
  if (!baseUrl) throw new DoclingError("Docling is not configured (DOCLING_API_URL is not set).");
  return {
    baseUrl,
    timeoutMs: (Number(process.env.DOCLING_TIMEOUT_SECONDS) || 300) * 1000,
  };
}

/** Options sent to docling-serve: Markdown output only, images referenced rather than embedded. */
function buildOptions(o: ConversionOptions): Record<string, unknown> {
  const options: Record<string, unknown> = { to_formats: ["md"], image_export_mode: "referenced" };
  if (o.doOcr !== undefined) options.do_ocr = o.doOcr;
  if (o.pageRange) options.page_range = o.pageRange;
  if (o.tableMode) options.table_mode = o.tableMode;
  return options;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const { baseUrl, timeoutMs } = settings();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new DoclingError("Docling request timed out.");
    }
    console.error("docling request failed:", err instanceof Error ? err.message : "unknown error");
    throw new DoclingError("Cannot reach the Docling service.");
  }
  if (!res.ok) {
    console.error(`docling ${method} ${path} returned HTTP ${res.status}`);
    throw new DoclingError(`Docling service returned HTTP ${res.status}.`);
  }
  return res.json();
}

function parseDocument(data: unknown): DocumentResult {
  if (!data || typeof data !== "object") throw new DoclingError("Unexpected response from Docling.");
  const d = data as Record<string, unknown>;
  const doc = (d.document && typeof d.document === "object" ? d.document : {}) as Record<string, unknown>;
  return {
    status: typeof d.status === "string" ? d.status : null,
    processingTime: typeof d.processing_time === "number" ? d.processing_time : null,
    errors: Array.isArray(d.errors) ? d.errors : [],
    filename: typeof doc.filename === "string" ? doc.filename : null,
    markdown: typeof doc.md_content === "string" ? doc.md_content : "",
  };
}

function parseTask(data: unknown): TaskInfo {
  if (!data || typeof data !== "object") throw new DoclingError("Unexpected response from Docling.");
  const d = data as Record<string, unknown>;
  if (typeof d.task_id !== "string" || typeof d.task_status !== "string") {
    throw new DoclingError("Unexpected task response from Docling.");
  }
  return {
    taskId: d.task_id,
    taskStatus: d.task_status,
    taskPosition: typeof d.task_position === "number" ? d.task_position : null,
  };
}

/** Convert a document at an http(s) URL and wait for the Markdown result. */
export async function convertUrl(url: string, options: ConversionOptions): Promise<DocumentResult> {
  const data = await call("POST", "/v1/convert/source", {
    sources: [{ kind: "http", url }],
    options: buildOptions(options),
  });
  return parseDocument(data);
}

/** Queue an asynchronous conversion. Returns a task to poll. */
export async function startConversion(url: string, options: ConversionOptions): Promise<TaskInfo> {
  const data = await call("POST", "/v1/convert/source/async", {
    sources: [{ kind: "http", url }],
    options: buildOptions(options),
  });
  return parseTask(data);
}

/** Poll a task. The server holds the request up to `waitSeconds` (server-side wait). */
export async function getTaskStatus(taskId: string, waitSeconds: number): Promise<TaskInfo> {
  const data = await call(
    "GET",
    `/v1/status/poll/${encodeURIComponent(taskId)}?wait=${encodeURIComponent(String(waitSeconds))}`,
  );
  return parseTask(data);
}

/** Fetch the result of a finished task. */
export async function getTaskResult(taskId: string): Promise<DocumentResult> {
  const data = await call("GET", `/v1/result/${encodeURIComponent(taskId)}`);
  return parseDocument(data);
}
