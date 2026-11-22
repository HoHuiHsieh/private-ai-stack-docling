import type { McpServerDef, McpTool } from "../server";
import { openWebUIEvents } from "../openwebui";
import {
  convertUrl,
  getTaskResult,
  getTaskStatus,
  startConversion,
  TERMINAL_STATUSES,
  type ConversionOptions,
  type DocumentResult,
} from "../../docling/client";

/**
 * Document conversion via Docling Serve (PDF, DOCX, PPTX, XLSX, HTML, images to Markdown).
 * Port of _mcp/docling. Served at /api/mcp/docling.
 */

const TASK_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_CHARS_DEFAULT = 50000;

function parseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) {
    throw new Error('"url" must be an http(s) URL of 8-2048 characters');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('"url" must be a valid http(s) URL');
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error('"url" must start with http:// or https://');
  }
  return value;
}

function parseMaxChars(value: unknown): number {
  if (value === undefined) return MAX_CHARS_DEFAULT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > 500000) {
    throw new Error('"max_chars" must be an integer from 1000 to 500000');
  }
  return value;
}

function parseTaskId(value: unknown): string {
  if (typeof value !== "string" || !TASK_ID.test(value)) {
    throw new Error('"task_id" must be the task_id returned by start_document_conversion');
  }
  return value;
}

/** Shared optional conversion parameters: do_ocr, page_range, table_mode. */
function parseOptions(args: Record<string, unknown>): ConversionOptions {
  const options: ConversionOptions = {};
  if (args.do_ocr !== undefined) {
    if (typeof args.do_ocr !== "boolean") throw new Error('"do_ocr" must be true or false');
    options.doOcr = args.do_ocr;
  }
  if (args.page_range !== undefined) {
    const r = args.page_range;
    if (
      !Array.isArray(r) ||
      r.length !== 2 ||
      !r.every((n) => typeof n === "number" && Number.isInteger(n)) ||
      (r[0] as number) < 1 ||
      (r[0] as number) > (r[1] as number)
    ) {
      throw new Error('"page_range" must be [first, last] with 1 <= first <= last (1-indexed, inclusive)');
    }
    options.pageRange = [r[0] as number, r[1] as number];
  }
  if (args.table_mode !== undefined) {
    if (args.table_mode !== "fast" && args.table_mode !== "accurate") {
      throw new Error('"table_mode" must be "fast" or "accurate"');
    }
    options.tableMode = args.table_mode;
  }
  return options;
}

const CONVERSION_PROPERTIES = {
  url: { type: "string", description: "http(s) URL of the document (PDF, DOCX, PPTX, XLSX, HTML, image, ...)" },
  do_ocr: { type: "boolean", description: "Force OCR on or off. Leave unset for the server default (on)." },
  page_range: {
    type: "array",
    items: { type: "integer" },
    minItems: 2,
    maxItems: 2,
    description: "Only convert pages [first, last] (1-indexed, inclusive), e.g. [1, 5]",
  },
  table_mode: { type: "string", enum: ["fast", "accurate"], description: "Table structure mode (server default: accurate)" },
};

function shapeResult(doc: DocumentResult, maxChars: number): string {
  const truncated = doc.markdown.length > maxChars;
  return JSON.stringify(
    {
      status: doc.status,
      processing_time: doc.processingTime,
      errors: doc.errors,
      document: {
        filename: doc.filename,
        md_content: doc.markdown.slice(0, maxChars),
        truncated,
      },
    },
    null,
    2,
  );
}

const convertTool: McpTool = {
  name: "convert_document_url",
  description:
    "Convert a document at a URL to Markdown. Waits for completion, so it suits small to medium documents; " +
    "for large ones use start_document_conversion. Images are referenced, not embedded. Long content is cut " +
    "to max_chars and flagged with document.truncated; use page_range to read the rest.",
  inputSchema: {
    type: "object",
    properties: {
      ...CONVERSION_PROPERTIES,
      max_chars: { type: "integer", description: "Truncate the Markdown to this many characters, 1000-500000 (default 50000)" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const url = parseUrl(args.url);
    const options = parseOptions(args);
    const maxChars = parseMaxChars(args.max_chars);
    const ui = openWebUIEvents(ctx);
    await ui.status("Converting document with Docling...");
    try {
      const doc = await convertUrl(url, options);
      await ui.status("Document converted", true);
      return shapeResult(doc, maxChars);
    } catch (err) {
      await ui.status("Document conversion failed", true);
      throw err;
    }
  },
};

const startTool: McpTool = {
  name: "start_document_conversion",
  description:
    "Start an asynchronous conversion of a document at a URL. Returns a task_id immediately. Then call " +
    "get_conversion_status until task_status is success or partial_success, and get_conversion_result for the content.",
  inputSchema: {
    type: "object",
    properties: CONVERSION_PROPERTIES,
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const url = parseUrl(args.url);
    const task = await startConversion(url, parseOptions(args));
    return JSON.stringify(
      { task_id: task.taskId, task_status: task.taskStatus, task_position: task.taskPosition },
      null,
      2,
    );
  },
};

const statusTool: McpTool = {
  name: "get_conversion_status",
  description:
    "Get the status of an asynchronous conversion task. task_status is pending, started, success, " +
    "partial_success, failure or skipped. Set wait to hold the request up to that many seconds until the task finishes.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID returned by start_document_conversion" },
      wait: { type: "number", description: "Seconds to wait for a terminal status, 0-60 (default 0)" },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const taskId = parseTaskId(args.task_id);
    const wait = args.wait ?? 0;
    if (typeof wait !== "number" || wait < 0 || wait > 60) {
      throw new Error('"wait" must be a number from 0 to 60');
    }
    const task = await getTaskStatus(taskId, Math.floor(wait));
    return JSON.stringify(
      {
        task_id: task.taskId,
        task_status: task.taskStatus,
        task_position: task.taskPosition,
        finished: TERMINAL_STATUSES.has(task.taskStatus),
      },
      null,
      2,
    );
  },
};

const resultTool: McpTool = {
  name: "get_conversion_result",
  description:
    "Get the Markdown content of a completed asynchronous conversion task. Only call after get_conversion_status " +
    "reports success or partial_success.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID of a successfully completed task" },
      max_chars: { type: "integer", description: "Truncate the Markdown to this many characters, 1000-500000 (default 50000)" },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const taskId = parseTaskId(args.task_id);
    const maxChars = parseMaxChars(args.max_chars);
    return shapeResult(await getTaskResult(taskId), maxChars);
  },
};

export const doclingServer: McpServerDef = {
  name: "docling",
  version: "0.1.0",
  tools: [convertTool, startTool, statusTool, resultTool],
};
