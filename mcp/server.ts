/**
 * Docling MCP server. Serves on port 3000 (internal, no published ports):
 *   POST /api/mcp/docling                       MCP JSON-RPC (Streamable HTTP)
 *   GET  /api/mcp/docling/protected-resource    OAuth protected-resource metadata (RFC 9728)
 *   GET  /healthz                               liveness
 * nginx's app vhost routes /api/mcp/docling to this container.
 *
 * Document conversion calls the docling container (DOCLING_API_URL). Chat events go through the line
 * service, which holds the Open WebUI key (LINE_SERVICE_URL, INTERNAL_API_TOKEN).
 *
 * Plain Node http. It converts each request to the Web Request/Response types that lib/mcp/http.ts uses.
 */
import http from "node:http";
import { Readable } from "node:stream";
import { handleMcpPost, methodNotAllowed } from "./lib/mcp/http";
import { doclingServer } from "./lib/mcp/servers/docling";

const PORT = Number(process.env.PORT) || 3000;
const MCP_PATH = `/api/mcp/${doclingServer.name}`;

function toRequest(req: http.IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: "half",
  } as RequestInit);
}

/** Copies a Web Response to the Node response, streaming the body so SSE works. */
async function send(res: http.ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.on("close", () => {
    reader.cancel().catch(() => {});
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

/** Same logic as app/api/mcp/[name]/protected-resource in agent-service. */
function protectedResource(): Response {
  const base = process.env.APP_PUBLIC_URL?.replace(/\/$/, "");
  const issuer = process.env.OIDC_ISSUER;
  if (!base || !issuer) {
    return Response.json({ error: "protected resource metadata is not configured" }, { status: 500 });
  }
  return Response.json(
    {
      resource: `${base}${MCP_PATH}`,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource_name: "Docling MCP",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function route(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/healthz") return new Response("ok", { headers: { "Content-Type": "text/plain" } });
  if (url.pathname === `${MCP_PATH}/protected-resource`) {
    return req.method === "GET" ? protectedResource() : methodNotAllowed();
  }
  if (url.pathname === MCP_PATH) {
    return req.method === "POST" ? handleMcpPost(req, doclingServer) : methodNotAllowed();
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    await send(res, await route(toRequest(req, url), url));
  } catch (err) {
    console.error("docling-mcp request failed:", err instanceof Error ? err.message : "unknown error");
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`docling-mcp listening on ${PORT}`);
});
