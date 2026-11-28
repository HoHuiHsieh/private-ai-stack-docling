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
import { extractImages, hasEmbeddedImages, imageBaseName, type ExtractedImage } from "../../docling/images";
import { uploadToOpenTerminal } from "../../upload/open-terminal";
import { uploadToOpenWebUI } from "../../upload/open-webui";
import { UploadError } from "../../upload/common";

/**
 * Document conversion via Docling Serve (PDF, DOCX, PPTX, XLSX, HTML, images to Markdown).
 * Port of _mcp/docling. Served at /api/mcp/docling.
 */

const TASK_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_CHARS_DEFAULT = 50000;

type PublishedImage = {
  name: string;
  /** Where the image went: "open_terminal" when a terminal path was given, else "open_webui". */
  destination: "open_terminal" | "open_webui";
  /** Open Terminal: the stored path. Open WebUI: the file id. */
  location?: string;
  size: number;
  error?: string;
};

type Published = { markdown: string; images: PublishedImage[]; skipped: number };

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

/** A directory path inside Open Terminal. Absent means the Open WebUI file store is used instead. */
function parseTerminalPath(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 300 || /[\r\n\0]/.test(value)) {
    throw new Error('"open_terminal_path" must be a directory path of 1-300 characters');
  }
  return value.trim();
}

/** Shared optional conversion parameters: do_ocr, page_range, table_mode, extract_images. */
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
  if (args.extract_images !== undefined) {
    if (typeof args.extract_images !== "boolean") throw new Error('"extract_images" must be true or false');
    options.embedImages = args.extract_images;
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
  extract_images: {
    type: "boolean",
    description:
      "Extract pictures from the document and upload them. Default false. The Markdown then refers to each " +
      "picture by file name. Where they go depends on open_terminal_path.",
  },
};

const TERMINAL_PATH_PROPERTY = {
  type: "string",
  description:
    "Directory path inside Open Terminal for the extracted images (e.g. /home/user/docling). When given, the " +
    "images are uploaded to Open Terminal. When omitted, they are uploaded to the Open WebUI file store.",
};

function baseNameOf(doc: DocumentResult): string {
  return imageBaseName(doc.filename);
}

/** Pull pictures out of the Markdown and upload them. Upload failures are reported per image. */
async function publishImages(
  doc: DocumentResult,
  terminalPath: string | undefined,
  openWebUIUser: string | undefined,
): Promise<Published> {
  if (!hasEmbeddedImages(doc.markdown)) return { markdown: doc.markdown, images: [], skipped: 0 };

  const extraction = extractImages(doc.markdown, baseNameOf(doc));
  const images: PublishedImage[] = [];

  for (const image of extraction.images) {
    images.push(await uploadOne(image, terminalPath, openWebUIUser));
  }
  return { markdown: extraction.markdown, images, skipped: extraction.skipped };
}

async function uploadOne(
  image: ExtractedImage,
  terminalPath: string | undefined,
  openWebUIUser: string | undefined,
): Promise<PublishedImage> {
  const destination = terminalPath ? "open_terminal" : "open_webui";
  const base = { name: image.name, destination, size: image.bytes.length } as const;
  try {
    if (terminalPath) {
      if (!openWebUIUser) {
        throw new UploadError(
          "Open Terminal upload needs the Open WebUI user id. Set ENABLE_FORWARD_USER_INFO_HEADERS on open-webui.",
        );
      }
      return { ...base, location: await uploadToOpenTerminal(image, { directory: terminalPath, userId: openWebUIUser }) };
    }
    return { ...base, location: await uploadToOpenWebUI(image) };
  } catch (err) {
    console.error(`image upload to ${destination} failed:`, err instanceof Error ? err.message : "unknown error");
    return { ...base, error: err instanceof UploadError ? err.message : "Upload failed." };
  }
}

function shapeResult(doc: DocumentResult, maxChars: number, published: Published): string {
  const truncated = published.markdown.length > maxChars;
  return JSON.stringify(
    {
      status: doc.status,
      processing_time: doc.processingTime,
      errors: doc.errors,
      document: {
        filename: doc.filename,
        md_content: published.markdown.slice(0, maxChars),
        truncated,
      },
      ...(published.images.length || published.skipped
        ? { images: published.images, images_skipped: published.skipped }
        : {}),
    },
    null,
    2,
  );
}

const convertTool: McpTool = {
  name: "convert_document_url",
  description:
    "Convert a document at a URL to Markdown. Waits for completion, so it suits small to medium documents; " +
    "for large ones use start_document_conversion. Images are referenced, not embedded, unless extract_images " +
    "is true: then each picture is uploaded to open_terminal_path in Open Terminal when given, otherwise to the " +
    "Open WebUI file store, and listed under images. Long content is cut to max_chars and flagged with " +
    "document.truncated; use page_range to read the rest.",
  inputSchema: {
    type: "object",
    properties: {
      ...CONVERSION_PROPERTIES,
      open_terminal_path: TERMINAL_PATH_PROPERTY,
      max_chars: { type: "integer", description: "Truncate the Markdown to this many characters, 1000-500000 (default 50000)" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const url = parseUrl(args.url);
    const options = parseOptions(args);
    const terminalPath = parseTerminalPath(args.open_terminal_path);
    const maxChars = parseMaxChars(args.max_chars);
    const ui = openWebUIEvents(ctx);
    await ui.status("Converting document with Docling...");
    try {
      const doc = await convertUrl(url, options);
      if (hasEmbeddedImages(doc.markdown)) await ui.status("Uploading extracted images...");
      const published = await publishImages(doc, terminalPath, ctx.headers.get("x-openwebui-user-id") ?? undefined);
      await ui.status("Document converted", true);
      return shapeResult(doc, maxChars, published);
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
    "get_conversion_status until task_status is success or partial_success, and get_conversion_result for the content. " +
    "With extract_images, pass open_terminal_path to get_conversion_result to choose where the pictures go.",
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
    "reports success or partial_success. If the task was started with extract_images, the pictures are uploaded " +
    "to open_terminal_path in Open Terminal when given, otherwise to the Open WebUI file store, and listed under images.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID of a successfully completed task" },
      open_terminal_path: TERMINAL_PATH_PROPERTY,
      max_chars: { type: "integer", description: "Truncate the Markdown to this many characters, 1000-500000 (default 50000)" },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const taskId = parseTaskId(args.task_id);
    const terminalPath = parseTerminalPath(args.open_terminal_path);
    const maxChars = parseMaxChars(args.max_chars);
    const doc = await getTaskResult(taskId);
    const published = await publishImages(doc, terminalPath, ctx.headers.get("x-openwebui-user-id") ?? undefined);
    return shapeResult(doc, maxChars, published);
  },
};

export const doclingServer: McpServerDef = {
  name: "docling",
  version: "0.2.0",
  tools: [convertTool, startTool, statusTool, resultTool],
};
