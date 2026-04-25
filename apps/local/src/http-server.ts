// http-server — local HTTP server with MCP + REST API + static UI.
//
// Serves:
//   /api/workspaces     → workspace management
//   /api/*              → REST API (workspace CRUD, requires open workspace)
//   /mcp                → MCP Streamable HTTP transport
//   /*                  → Static SPA (local web UI)

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat, rm, rename } from "node:fs/promises";
import { createServer } from "node:net";
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
import { startSourceScheduler } from "./rss-scheduler.js";
import type { SourceScheduler } from "./rss-scheduler.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { templates, findTemplate } from "./templates/index.js";
import { initWorkspace } from "./init.js";

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
  scheduler: SourceScheduler | null;
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
    scheduler: null,
  };

  // Detect available CLI providers in parallel.
  const registry = await createProviderRegistry();
  const availableNames = registry.info
    .filter((p) => p.available)
    .map((p) => p.name);
  console.log(`[codoc] providers: ${availableNames.length > 0 ? availableNames.join(", ") : "none detected"}`);

  // If initial workspace provided, set up MCP, watcher, and RSS scheduler.
  if (state.workspace) {
    await setupMcp(state, registry);
    state.watcher = startWatcher(state.workspace);
    startScheduler(state);
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

    // Close existing watcher and scheduler.
    stopScheduler(state);
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

    // Set up MCP, watcher, and RSS scheduler.
    await setupMcp(state, registry);
    state.watcher = startWatcher(ws);
    startScheduler(state);

    console.log(`[codoc] opened workspace: ${name} (${ws.codocs.size} codocs)`);
    return c.json({ ok: true, codocCount: ws.codocs.size });
  });

  app.post("/api/workspaces", async (c) => {
    const body = await c.req.json<{ name: string }>();
    const { name } = body;

    if (!name || !name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }

    const workspaceDir = join(CODOC_HOME, name);
    try {
      await stat(workspaceDir);
      return c.json({ error: `workspace "${name}" already exists` }, 409);
    } catch { /* doesn't exist — good */ }

    await initWorkspace(workspaceDir);
    console.log(`[codoc] created empty workspace: ${name}`);
    return c.json({ ok: true, name });
  });

  app.delete("/api/workspaces/:name", async (c) => {
    const name = c.req.param("name");
    const workspaceDir = join(CODOC_HOME, name);

    try {
      await stat(workspaceDir);
    } catch {
      return c.json({ error: `workspace "${name}" not found` }, 404);
    }

    // If deleting the currently open workspace, close it first.
    if (state.workspaceName === name) {
      stopScheduler(state);
      if (state.watcher) {
        await state.watcher.close();
        state.watcher = null;
      }
      state.workspace = null;
      state.workspaceName = null;
      state.mcpTransport = null;
    }

    await rm(workspaceDir, { recursive: true });
    console.log(`[codoc] deleted workspace: ${name}`);
    return c.json({ ok: true });
  });

  app.patch("/api/workspaces/:name", async (c) => {
    const oldName = c.req.param("name");
    const body = await c.req.json<{ name: string }>();
    const newName = body.name;

    if (!newName || !newName.trim()) {
      return c.json({ error: "new name is required" }, 400);
    }
    if (newName === oldName) {
      return c.json({ ok: true, name: oldName });
    }

    const oldDir = join(CODOC_HOME, oldName);
    const newDir = join(CODOC_HOME, newName);

    try {
      await stat(oldDir);
    } catch {
      return c.json({ error: `workspace "${oldName}" not found` }, 404);
    }

    try {
      await stat(newDir);
      return c.json({ error: `workspace "${newName}" already exists` }, 409);
    } catch { /* doesn't exist — good */ }

    await rename(oldDir, newDir);

    // If renaming the currently open workspace, update state.
    if (state.workspaceName === oldName) {
      state.workspaceName = newName;
    }

    console.log(`[codoc] renamed workspace: ${oldName} → ${newName}`);
    return c.json({ ok: true, name: newName });
  });

  // ---- Workspace config (includes template interaction metadata) -----------

  app.get("/api/config", async (c) => {
    if (!state.workspace) {
      return c.json({ error: "no workspace open" }, 503);
    }
    try {
      const raw = await readFile(join(state.workspace.sourceDir, "codoc.config.json"), "utf-8");
      return c.json(JSON.parse(raw));
    } catch {
      return c.json({});
    }
  });

  app.patch("/api/config", async (c) => {
    if (!state.workspace) {
      return c.json({ error: "no workspace open" }, 503);
    }

    const patch = await c.req.json<Record<string, unknown>>();
    const configPath = join(state.workspace.sourceDir, "codoc.config.json");

    // Read existing config, merge patch, write back.
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
    } catch { /* no existing config */ }

    const merged = { ...existing, ...patch };
    await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

    return c.json({ ok: true, config: merged });
  });

  // ---- Templates -----------------------------------------------------------

  app.get("/api/templates", (c) => {
    return c.json(
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      })),
    );
  });

  app.post("/api/workspaces/from-template", async (c) => {
    const body = await c.req.json<{ name: string; templateId: string }>();
    const { name, templateId } = body;

    if (!name || !templateId) {
      return c.json({ error: "name and templateId required" }, 400);
    }

    const template = findTemplate(templateId);
    if (!template) {
      return c.json({ error: `unknown template: "${templateId}"` }, 400);
    }

    // Check if workspace already exists.
    const workspaceDir = join(CODOC_HOME, name);
    try {
      await stat(workspaceDir);
      return c.json({ error: `workspace "${name}" already exists` }, 409);
    } catch { /* doesn't exist — good */ }

    // Create workspace with template.
    await initWorkspace(workspaceDir, { template });

    // Open it immediately.
    const outDir = workspaceDir;
    const sourceProviders = createSourceRegistry();
    const ws = await loadWorkspace(workspaceDir, outDir, sourceProviders);
    await compileAll(ws);

    stopScheduler(state);
    if (state.watcher) {
      await state.watcher.close();
      state.watcher = null;
    }

    state.workspace = ws;
    state.workspaceName = name;

    await setupMcp(state, registry);
    state.watcher = startWatcher(ws);
    startScheduler(state);

    console.log(`[codoc] created workspace from template: ${name} (${template.name}, ${ws.codocs.size} codocs)`);
    return c.json({ ok: true, name, codocCount: ws.codocs.size });
  });

  // ---- REST API -----------------------------------------------------------
  const apiRoutes = createApiRoutes(state, registry);
  app.route("/api", apiRoutes);

  // ---- Chat (provider-aware proxy) ---------------------------------------
  const chatRoutes = createChatRoutes(state, registry);
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

  const actualPort = await findFreePort(port);
  if (actualPort !== port) {
    console.log(`[codoc] port ${port} in use, using ${actualPort}`);
  }

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: actualPort }, (info) => {
      console.log(`[codoc] server listening on http://localhost:${info.port}`);
      console.log(`[codoc] MCP endpoint: http://localhost:${info.port}/mcp`);
      if (hasUi) {
        console.log(`[codoc] UI: http://localhost:${info.port}`);
      }
      resolve({ port: info.port, close: () => server.close() });
    });
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

async function findFreePort(preferred: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortFree(preferred + i)) return preferred + i;
  }
  throw new Error(`no free port found in range ${preferred}–${preferred + maxAttempts - 1}`);
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

async function setupMcp(state: AppState, registry?: ProviderRegistry): Promise<void> {
  if (!state.workspace) return;
  const mcpServer = createMcpServer(state.workspace, registry);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);
  state.mcpTransport = transport;
}

function startScheduler(state: AppState): void {
  if (!state.workspace) return;
  state.scheduler = startSourceScheduler(state.workspace);
}

function stopScheduler(state: AppState): void {
  if (state.scheduler) {
    state.scheduler.stop();
    state.scheduler = null;
  }
}
