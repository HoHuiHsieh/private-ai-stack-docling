# docling

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
    `DOCLING_API_URL` (`http://docling:5001`), `DOCLING_TIMEOUT_SECONDS`, `LINE_SERVICE_URL`, `INTERNAL_API_TOKEN`
    (must match the line service; used to send chat events).
- **`models.json`**: none. Docling does not use models in this stack.

## Secrets

None. The MCP has no per-user secrets. Access is controlled by the Keycloak bearer token on each request.

## MCP tools

Endpoint: `POST /api/mcp/docling` (Keycloak bearer token).

| Tool | Arguments | What it does |
|---|---|---|
| `convert_document_url` | `url` (required), `max_chars` (optional, 1000-500000, default 50000) | Converts a document to Markdown and waits for the result. Use for small to medium documents |
| `start_document_conversion` | `url` (required) | Starts an asynchronous conversion and returns `task_id` at once |
| `get_conversion_status` | `task_id` (required), `wait` (optional, seconds 0-60, default 0) | Returns `task_status`: pending, started, success, partial_success, failure or skipped |
| `get_conversion_result` | `task_id` (required), `max_chars` (optional) | Returns the Markdown of a completed task. Call only after success or partial_success |

Large documents: `start_document_conversion`, then `get_conversion_status` until success or partial_success, then `get_conversion_result`.
Images are referenced, not embedded.

## Verify

- `docker compose --env-file .env -f services/docling/docker-compose.yml ps`
- `curl` the health endpoint from inside the network: `docker compose ... exec docling-mcp wget -qO- http://127.0.0.1:3000/healthz`
- Call `convert_document_url` on a small PDF and check the Markdown comes back.
