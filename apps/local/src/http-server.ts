// http-server — local HTTP server with MCP (Streamable HTTP) mounted.
//
// Serves:
//   GET  /          → health check
//   ALL  /mcp       → MCP Streamable HTTP transport
//
// Phase 1 will add: static file serving, WebSocket push, REST API.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HttpServerOptions {
  readonly port: number;
  readonly mcpServer: McpServer;
}

export interface HttpServerHandle {
  readonly port: number;
  close: () => void;
}

export async function startHttpServer(
  options: HttpServerOptions,
): Promise<HttpServerHandle> {
  const { port, mcpServer } = options;

  // Stateful transport — supports multiple requests within a session.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);

  const app = new Hono();

  app.get("/", (c) => c.json({ name: "codoc", status: "ok" }));

  app.all("/mcp", async (c) => {
    const response = await transport.handleRequest(c.req.raw);
    return response;
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[codoc] server listening on http://localhost:${info.port}`);
      console.log(`[codoc] MCP endpoint: http://localhost:${info.port}/mcp`);
      resolve({ port: info.port, close: () => server.close() });
    });
  });
}
