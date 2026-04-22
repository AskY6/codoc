// http-server — local HTTP server with MCP + REST API + static UI.
//
// Serves:
//   /api/*     → REST API (workspace CRUD)
//   /mcp       → MCP Streamable HTTP transport
//   /*         → Static SPA (local web UI)

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Workspace } from "./workspace.js";
import { createApiRoutes } from "./api-routes.js";
import { createChatRoutes } from "./chat-route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDistDir = join(__dirname, "ui");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export interface HttpServerOptions {
  readonly port: number;
  readonly mcpServer: McpServer;
  readonly workspace: Workspace;
}

export interface HttpServerHandle {
  readonly port: number;
  close: () => void;
}

export async function startHttpServer(
  options: HttpServerOptions,
): Promise<HttpServerHandle> {
  const { port, mcpServer, workspace } = options;

  // Stateful transport — supports multiple requests within a session.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);

  const app = new Hono();

  // ---- REST API -----------------------------------------------------------
  const apiRoutes = createApiRoutes(workspace);
  app.route("/api", apiRoutes);

  // ---- Chat (Claude Code SDK proxy) --------------------------------------
  const chatRoutes = createChatRoutes({ sourceDir: workspace.sourceDir, port });
  app.route("/api", chatRoutes);

  // ---- MCP ----------------------------------------------------------------
  app.all("/mcp", async (c) => {
    const response = await transport.handleRequest(c.req.raw);
    return response;
  });

  // ---- Static UI ----------------------------------------------------------
  const hasUi = existsSync(uiDistDir);

  if (hasUi) {
    // Serve static files from dist/ui/ with SPA fallback
    app.get("*", async (c) => {
      const urlPath = new URL(c.req.url).pathname;
      const filePath = join(uiDistDir, urlPath);

      // Try serving the exact file
      try {
        const s = await stat(filePath);
        if (s.isFile()) {
          const content = await readFile(filePath);
          const mime = MIME[extname(filePath)] ?? "application/octet-stream";
          return new Response(content, { headers: { "Content-Type": mime } });
        }
      } catch {
        // File not found — fall through to SPA
      }

      // SPA fallback
      const html = await readFile(join(uiDistDir, "index.html"), "utf-8");
      return c.html(html);
    });
  } else {
    app.get("/", (c) =>
      c.json({
        name: "codoc",
        status: "ok",
        ui: "not built — run 'pnpm build:ui' in apps/local",
      }),
    );
  }

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[codoc] server listening on http://localhost:${info.port}`);
      console.log(`[codoc] MCP endpoint: http://localhost:${info.port}/mcp`);
      if (hasUi) {
        console.log(`[codoc] UI: http://localhost:${info.port}`);
      }
      resolve({ port: info.port, close: () => server.close() });
    });
  });
}
