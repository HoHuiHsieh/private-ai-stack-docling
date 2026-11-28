# docling

> This directory is a sub-project of [`private-ai-stack`](https://github.com/HoHuiHsieh/private-ai-stack).

Document conversion (PDF, DOCX, PPTX, XLSX, HTML, images to Markdown) through Docling Serve, exposed as an MCP server.

## Containers

| Service | Role | Ports |
|---|---|---|
| `docling` | Docling Serve API on `http://docling:5001` (GPU) | none (internal) |
| `docling-mcp` | MCP server `/api/mcp/docling`, calls `docling` | none (internal) |

Start: `./start.sh prod docling` (or `./start.sh dev docling`). The `docling-mcp` container needs the `docling` container up.

Also available in the Docling Serve UI at `DOCLING_HOST`, when `DOCLING_SERVE_ENABLE_UI=true` in `env/.env.docling`.

## Configuration

- **Env files** (`env/`, created from the `.example` files, never committed):
  - `.env.docling`: Docling Serve settings (`DOCLING_SERVE_ENABLE_UI`, and other tuning).
  - `.env.docling-mcp`: `MCP_JWKS_URL`, `MCP_JWT_ISSUER`, `MCP_JWT_AUDIENCE`, `OIDC_ISSUER`, `APP_PUBLIC_URL`,
    `DOCLING_API_URL` (`http://docling:5001`), `DOCLING_TIMEOUT_SECONDS`, `INTERNAL_API_TOKEN`
    (must match the line service; used to send chat events),
    `OPEN_WEBUI_URL` (Open WebUI image uploads), `OPEN_TERMINAL_URL` and `OPEN_TERMINAL_API_KEY` (Open Terminal image uploads),
    `AGENT_DATABASE_URL` and `SECRETS_ENCRYPTION_KEY` (the encrypted per-user Open WebUI key; same values as agent-service).
- **`models.json`**: none. Docling does not use models in this stack.

## Secrets

Each user's Open WebUI API key is entered through the `docling_set_open_webui_key` secure form (elicitation).
It is encrypted with `SECRETS_ENCRYPTION_KEY` and stored in the shared `service_secrets` table, keyed by the
user's Keycloak `sub` and the service `docling`. The value is never shown back to the model or logged. Check
whether a key is stored with `docling_check_open_webui_key` (reports presence and timestamp only).

Uploads to Open WebUI use the caller's own key, so the files belong to that user. Keep the same
`SECRETS_ENCRYPTION_KEY` for the life of the table: a changed key makes stored keys unreadable.

## MCP tools

Endpoint: `POST /api/mcp/docling` (Keycloak bearer token).

| Tool | Arguments | What it does |
|---|---|---|
| `convert_document_url` | `url` (required), `max_chars` (optional, 1000-500000, default 50000) | Converts a document to Markdown and waits for the result. Use for small to medium documents |
| `start_document_conversion` | `url` (required) | Starts an asynchronous conversion and returns `task_id` at once |
| `get_conversion_status` | `task_id` (required), `wait` (optional, seconds 0-60, default 0) | Returns `task_status`: pending, started, success, partial_success, failure or skipped |
| `get_conversion_result` | `task_id` (required), `open_terminal_path`, `max_chars` (optional) | Returns the Markdown of a completed task. Call only after success or partial_success |
| `docling_set_open_webui_key` | none (secure form) | Stores the caller's Open WebUI API key, encrypted |
| `docling_check_open_webui_key` | none | Reports whether a key is stored (presence and timestamp only) |

Large documents: `start_document_conversion`, then `get_conversion_status` until success or partial_success, then `get_conversion_result`.

### Image extraction

Set `extract_images: true` on `convert_document_url` or `start_document_conversion` to pull the pictures out of the document. Each picture is uploaded and the Markdown refers to it by file name. The response lists each one under `images` with its `destination`, `location` (Open Terminal path or Open WebUI file id), `size`, and an `error` when that upload failed. Without the flag, images stay referenced as before.

Where the pictures go depends on the tool input `open_terminal_path`:

| Input | Destination | Endpoint | Needs |
|---|---|---|---|
| `open_terminal_path` given | Open Terminal, in the caller's workspace | `POST {OPEN_TERMINAL_URL}/files/upload?directory=<open_terminal_path>` | `OPEN_TERMINAL_URL`, `OPEN_TERMINAL_API_KEY`, and the caller's Open WebUI user id (`X-OpenWebUI-User-Id`, so `open-webui` must forward user headers via `ENABLE_FORWARD_USER_INFO_HEADERS`) |
| omitted | Open WebUI file store | `POST {OPEN_WEBUI_URL}/api/v1/files/` | `OPEN_WEBUI_URL` and the caller's stored key (`docling_set_open_webui_key`) |

For async tasks, pass `extract_images` to `start_document_conversion` and `open_terminal_path` to `get_conversion_result`. Limits: 50 pictures and 10 MB each. Pictures beyond the limits are left out and counted in `images_skipped`.

## Verify

- `docker compose --env-file .env -f services/docling/docker-compose.yml ps`
- `curl` the health endpoint from inside the network: `docker compose ... exec docling-mcp wget -qO- http://127.0.0.1:3000/healthz`
- Call `convert_document_url` on a small PDF and check the Markdown comes back.
