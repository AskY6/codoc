// http-server — local HTTP server with MCP + REST API + static UI.
//
// Serves:
//   /api/workspaces     → workspace management
//   /api/*              → REST API (workspace CRUD, requires open workspace)
//   /mcp                → MCP Streamable HTTP transport
//   /*                  → Static SPA (local web UI)

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Workspace } from "./workspace.js";
import { loadWorkspace, compileAll } from "./workspace.js";
import { createSourceRegistry } from "@cobook/parser";
import { createApiRoutes } from "./api-routes.js";
import { createChatRoutes } from "./chat-route.js";
import { createMcpServer } from "./mcp-server.js";
import { startWatcher } from "./watcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDistDir = join(__dirname, "ui");
const CODOC_HOME = join(homedir(), ".codoc");

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

/** Mutable server state — workspace can be opened at runtime. */
export interface AppState {
  workspace: Workspace | null;
  workspaceName: string | null;
  mcpTransport: WebStandardStreamableHTTPServerTransport | null;
  watcher: { close: () => Promise<void> } | null;
}

export interface HttpServerOptions {
  readonly port: number;
  readonly initialWorkspace?: {
    name: string;
    workspace: Workspace;
  };
}

export interface HttpServerHandle {
  readonly port: number;
  close: () => void;
}

export async function startHttpServer(
  options: HttpServerOptions,
): Promise<HttpServerHandle> {
  const { port } = options;

  const state: AppState = {
    workspace: options.initialWorkspace?.workspace ?? null,
    workspaceName: options.initialWorkspace?.name ?? null,
    mcpTransport: null,
    watcher: null,
  };

  // If initial workspace provided, set up MCP and watcher.
  if (state.workspace) {
    await setupMcp(state);
    state.watcher = startWatcher(state.workspace);
  }

  const app = new Hono();

  // ---- Workspace management -----------------------------------------------

  app.get("/api/workspaces", async (c) => {
    const names = await listWorkspaceNames();
    return c.json(names);
  });

  app.get("/api/workspace", (c) => {
    if (!state.workspace) {
      return c.json({ active: false });
    }
    return c.json({
      active: true,
      name: state.workspaceName,
      codocCount: state.workspace.codocs.size,
    });
  });

  app.post("/api/workspaces/:name/open", async (c) => {
    const name = c.req.param("name");
    const workspaceDir = join(CODOC_HOME, name);

    try {
      await stat(workspaceDir);
    } catch {
      return c.json({ error: `workspace "${name}" not found` }, 404);
    }

    // Close existing watcher.
    if (state.watcher) {
      await state.watcher.close();
      state.watcher = null;
    }

    // Read workspace config.
    let outDir = workspaceDir;
    try {
      const cfg = JSON.parse(
        await readFile(join(workspaceDir, "codoc.config.json"), "utf-8"),
      ) as { outDir?: string };
      if (cfg.outDir) outDir = resolve(workspaceDir, cfg.outDir);
    } catch { /* use defaults */ }

    // Load workspace.
    const sourceProviders = createSourceRegistry();
    const ws = await loadWorkspace(workspaceDir, outDir, sourceProviders);
    await compileAll(ws);

    state.workspace = ws;
    state.workspaceName = name;

    // Set up MCP and watcher.
    await setupMcp(state);
    state.watcher = startWatcher(ws);

    console.log(`[codoc] opened workspace: ${name} (${ws.codocs.size} codocs)`);
    return c.json({ ok: true, codocCount: ws.codocs.size });
  });

  // ---- REST API -----------------------------------------------------------
  const apiRoutes = createApiRoutes(state);
  app.route("/api", apiRoutes);

  // ---- Chat (Claude Code SDK proxy) --------------------------------------
  const chatRoutes = createChatRoutes(state, port);
  app.route("/api", chatRoutes);

  // ---- MCP ----------------------------------------------------------------
  app.all("/mcp", async (c) => {
    if (!state.mcpTransport) {
      return c.json({ error: "no workspace open" }, 503);
    }
    const response = await state.mcpTransport.handleRequest(c.req.raw);
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function listWorkspaceNames(): Promise<string[]> {
  try {
    const entries = await readdir(CODOC_HOME, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function setupMcp(state: AppState): Promise<void> {
  if (!state.workspace) return;
  const mcpServer = createMcpServer(state.workspace);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);
  state.mcpTransport = transport;
}
