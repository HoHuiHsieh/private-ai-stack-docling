import type { McpContext } from "./server";
import { lineFetch } from "../line-client";

/**
 * Push live UI events from an MCP tool into the Open WebUI chat that called it.
 *
 * Open WebUI must forward the chat and message ids to us, either:
 *   - globally: ENABLE_FORWARD_USER_INFO_HEADERS=True on open-webui
 *     (sends X-OpenWebUI-Chat-Id / X-OpenWebUI-Message-Id), or
 *   - per connection: custom headers X-Chat-Id: {{CHAT_ID}} and X-Message-Id: {{MESSAGE_ID}}.
 *
 * Env (name only, set in .env / .env.dev):
 *   OPEN_WEBUI_URL      internal base URL, e.g. http://open-webui:8080 (same backend network)
 * The API key is the LINE credential open_webui_api_key, set with line_set_credentials
 * (Settings > Account > API Keys in Open WebUI creates it). It is not read from env.
 *
 * Events are best-effort: if ids or config are missing, or the POST fails,
 * the helper logs and does nothing, so the tool still returns its result.
 */

export type NotificationLevel = "info" | "success" | "warning" | "error";

export type OpenWebUIEvent = { type: string; data: Record<string, unknown> };

export type OpenWebUIEvents = {
  /** False when chat/message ids or config are missing; calls are then no-ops. */
  available: boolean;
  /** Progress banner above the response. Send done=true when finished. */
  status(description: string, done?: boolean): Promise<void>;
  /** Toast in the corner. */
  notify(content: string, level?: NotificationLevel): Promise<void>;
  /** Overwrite the message bubble. */
  replace(content: string): Promise<void>;
  /** Append text to the message bubble (best in Legacy tool mode). */
  append(content: string): Promise<void>;
  /** Clickable follow-up prompt chips. */
  followUps(items: string[]): Promise<void>;
  /** Rename the chat in the sidebar. */
  setTitle(title: string): Promise<void>;
  /** Add tags to the chat. */
  setTags(tags: string[]): Promise<void>;
  /** Error banner on the message. */
  error(content: string): Promise<void>;
  /** Send any raw event. */
  send(event: OpenWebUIEvent): Promise<void>;
};

const EVENT_TIMEOUT_MS = 5000;

function pick(headers: Headers, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

/** The Open WebUI chat id forwarded with this MCP request, or undefined when none was sent. */
export function chatIdOf(ctx: McpContext): string | undefined {
  return pick(ctx.headers, "x-openwebui-chat-id", "x-chat-id");
}

export function openWebUIEvents(ctx: McpContext): OpenWebUIEvents {
  const chatId = chatIdOf(ctx);
  const messageId = pick(ctx.headers, "x-openwebui-message-id", "x-message-id");
  const available = Boolean(chatId && messageId);

  async function send(event: OpenWebUIEvent): Promise<void> {
    if (!available) return;
    // The line service holds the Open WebUI key and forwards the event. Without it, events are skipped.
    try {
      const res = await lineFetch("/internal/chat-event", {
        method: "POST",
        body: { chatId, messageId, event },
        timeoutMs: EVENT_TIMEOUT_MS,
      });
      if (!res.ok) console.warn(`Open WebUI event "${event.type}" failed: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`Open WebUI event "${event.type}" failed:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    available,
    status: (description, done = false) =>
      send({ type: "status", data: { description, done, hidden: false } }),
    notify: (content, level = "info") => send({ type: "notification", data: { type: level, content } }),
    replace: (content) => send({ type: "replace", data: { content } }),
    append: (content) => send({ type: "message", data: { content } }),
    followUps: (items) => send({ type: "chat:message:follow_ups", data: { follow_ups: items } }),
    setTitle: (title) => send({ type: "chat:title", data: { title } }),
    setTags: (tags) => send({ type: "chat:tags", data: { tags } }),
    error: (content) => send({ type: "chat:message:error", data: { error: { content } } }),
    send,
  };
}
