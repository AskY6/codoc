// http — local HTTP server with MCP + REST API + static UI.
//
// Serves:
//   /api/workspaces     → workspace management
//   /api/*              → REST API (workspace CRUD, requires open workspace)
//   /mcp                → MCP Streamable HTTP transport
//   /*                  → Static SPA (local web UI)

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat, rm, rename } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Workspace } from "../workspace/index.js";
import { loadWorkspace, compileAll } from "../workspace/index.js";
import { createSourceRegistry } from "@cobook/parser";
import { createApiRoutes } from "./api-routes.js";
import { createChatRoutes } from "./chat-route.js";
import { createMcpServer } from "./mcp.js";
import { startWatcher } from "../workspace/watcher.js";
import { startSourceScheduler } from "../sources/scheduler.js";
import type { SourceScheduler } from "../sources/scheduler.js";
import { createProviderRegistry } from "../providers/registry.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { templates, findTemplate } from "../templates/index.js";
import { initWorkspace } from "../commands/init.js";
import type { WorkspacePlugin, WorkspacePluginContext, PluginJobHandle } from "../plugins/types.js";
import { parseWorkspaceConfig } from "../plugins/config.js";
import { resolvePlugin } from "../plugins/detect.js";

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

/** SSE update event pushed to connected clients. */
export interface UpdateEvent {
  readonly kind: "source-refreshed" | "codoc-updated" | "codoc-deleted";
  readonly codocPath?: string;
}

/** Mutable server state — workspace can be opened at runtime. */
export interface AppState {
  workspace: Workspace | null;
  workspaceName: string | null;
  mcpTransport: WebStandardStreamableHTTPServerTransport | null;
  watcher: { close: () => Promise<void> } | null;
  scheduler: SourceScheduler | null;
  activePlugin: WorkspacePlugin | null;
  pluginCtx: WorkspacePluginContext | null;
  pluginJobs: PluginJobHandle[];
  pluginRouter: Hono | null;
  /** Event bus for real-time UI push. */
  readonly updates: EventEmitter;
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
    activePlugin: null,
    pluginCtx: null,
    pluginJobs: [],
    pluginRouter: null,
    updates: new EventEmitter(),
  };

  // Detect available CLI providers in parallel.
  const registry = await createProviderRegistry();
  const availableNames = registry.info
    .filter((p) => p.available)
    .map((p) => p.name);
  console.log(`[codoc] providers: ${availableNames.length > 0 ? availableNames.join(", ") : "none detected"}`);

  // If initial workspace provided, set up MCP, watcher, and source scheduler.
  if (state.workspace && options.initialWorkspace) {
    const wsName = options.initialWorkspace.name;
    const workspaceDir = state.workspace.sourceDir;

    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(
        await readFile(join(workspaceDir, "codoc.config.json"), "utf-8"),
      ) as Record<string, unknown>;
    } catch { /* */ }
    const config = parseWorkspaceConfig(rawConfig);

    const { plugin, source } = resolvePlugin(state.workspace, config);
    const configResult = plugin.parseConfig(config.pluginConfig);
    state.activePlugin = plugin;
    state.pluginCtx = configResult.ok
      ? buildPluginContext(wsName, state.workspace, config, configResult.value, state.updates, registry)
      : null;
    console.log(`[plugin] activated: ${plugin.id} (${source})`);

    await setupMcp(state, registry, plugin, state.workspace, wsName, config, configResult.ok ? configResult.value : undefined);
    state.watcher = startWatcher(state.workspace);
    startScheduler(state);
    // Wait for first source refresh (articles available on first page load).
    if (state.scheduler) {
      await Promise.race([
        state.scheduler.ready,
        new Promise<void>((r) => setTimeout(r, 10_000)),
      ]);
    }

    if (configResult.ok && plugin.startJobs && state.pluginCtx) {
      state.pluginJobs = [...plugin.startJobs(state.pluginCtx)];
    }
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
    const plugin = state.activePlugin;
    const uiSpec = plugin?.getUiSpec && state.pluginCtx
      ? plugin.getUiSpec(state.pluginCtx)
      : undefined;
    return c.json({
      active: true,
      name: state.workspaceName,
      codocCount: state.workspace.codocs.size,
      pluginId: plugin?.id ?? "default",
      uiSpec,
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

    // Tear down existing workspace.
    teardownPlugin(state);
    stopScheduler(state);
    if (state.watcher) {
      await state.watcher.close();
      state.watcher = null;
    }

    // Read workspace config.
    let rawConfig: Record<string, unknown> = {};
    let outDir = workspaceDir;
    try {
      rawConfig = JSON.parse(
        await readFile(join(workspaceDir, "codoc.config.json"), "utf-8"),
      ) as Record<string, unknown>;
      if (typeof rawConfig.outDir === "string") outDir = resolve(workspaceDir, rawConfig.outDir);
    } catch { /* use defaults */ }

    const config = parseWorkspaceConfig(rawConfig);

    // Load workspace.
    const sourceProviders = createSourceRegistry();
    const ws = await loadWorkspace(workspaceDir, outDir, sourceProviders);
    await compileAll(ws);

    state.workspace = ws;
    state.workspaceName = name;

    // Resolve and activate plugin.
    const { plugin, source } = resolvePlugin(ws, config);
    const configResult = plugin.parseConfig(config.pluginConfig);
    if (!configResult.ok) {
      console.warn(`[plugin] config error for "${plugin.id}": ${configResult.error.message}`);
    }
    state.activePlugin = plugin;
    state.pluginCtx = configResult.ok
      ? buildPluginContext(name, ws, config, configResult.value, state.updates, registry)
      : null;
    console.log(`[plugin] activated: ${plugin.id} (${source})`);

    // Set up MCP (with plugin tools), watcher, and source scheduler.
    await setupMcp(state, registry, plugin, ws, name, config, configResult.ok ? configResult.value : undefined);
    state.watcher = startWatcher(ws);
    startScheduler(state);
    if (state.scheduler) {
      await Promise.race([
        state.scheduler.ready,
        new Promise<void>((r) => setTimeout(r, 10_000)),
      ]);
    }

    // Start plugin-specific jobs.
    if (configResult.ok && plugin.startJobs && state.pluginCtx) {
      state.pluginJobs = [...plugin.startJobs(state.pluginCtx)];
    }

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
      teardownPlugin(state);
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

    teardownPlugin(state);
    stopScheduler(state);
    if (state.watcher) {
      await state.watcher.close();
      state.watcher = null;
    }

    state.workspace = ws;
    state.workspaceName = name;

    // Read freshly written config and activate plugin.
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(
        await readFile(join(workspaceDir, "codoc.config.json"), "utf-8"),
      ) as Record<string, unknown>;
    } catch { /* */ }
    const config = parseWorkspaceConfig(rawConfig);

    const { plugin, source } = resolvePlugin(ws, config);
    const configResult = plugin.parseConfig(config.pluginConfig);
    state.activePlugin = plugin;
    state.pluginCtx = configResult.ok
      ? buildPluginContext(name, ws, config, configResult.value, state.updates, registry)
      : null;
    console.log(`[plugin] activated: ${plugin.id} (${source})`);

    await setupMcp(state, registry, plugin, ws, name, config, configResult.ok ? configResult.value : undefined);
    state.watcher = startWatcher(ws);
    startScheduler(state);
    if (state.scheduler) {
      await Promise.race([
        state.scheduler.ready,
        new Promise<void>((r) => setTimeout(r, 10_000)),
      ]);
    }

    if (configResult.ok && plugin.startJobs && state.pluginCtx) {
      state.pluginJobs = [...plugin.startJobs(state.pluginCtx)];
    }

    console.log(`[codoc] created workspace from template: ${name} (${template.name}, ${ws.codocs.size} codocs)`);
    return c.json({ ok: true, name, codocCount: ws.codocs.size });
  });

  // ---- SSE updates --------------------------------------------------------
  app.get("/api/updates", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: UpdateEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch { /* client disconnected */ }
        };
        state.updates.on("update", send);
        // Heartbeat every 30s to keep connection alive.
        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* */ }
        }, 30_000);
        // Cleanup is handled when the client drops the connection and
        // the next enqueue throws, so we also listen for cancel.
        c.req.raw.signal.addEventListener("abort", () => {
          state.updates.off("update", send);
          clearInterval(heartbeat);
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // ---- REST API -----------------------------------------------------------
  const apiRoutes = createApiRoutes(state, registry);
  app.route("/api", apiRoutes);

  // ---- Plugin API routes (dynamic — delegates to active plugin) ----------
  app.all("/api/plugins/:pluginId/*", async (c) => {
    const pluginId = c.req.param("pluginId");
    if (!state.activePlugin || state.activePlugin.id !== pluginId) {
      return c.json({ error: `plugin "${pluginId}" not active` }, 404);
    }
    if (!state.pluginRouter) {
      return c.json({ error: "plugin has no API routes" }, 404);
    }
    // Strip prefix so plugin routes match against "/" + relative path.
    const prefix = `/api/plugins/${pluginId}`;
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(prefix.length) || "/";
    const rewritten = new Request(url.toString(), c.req.raw);
    return state.pluginRouter.fetch(rewritten);
  });

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

async function setupMcp(
  state: AppState,
  registry?: ProviderRegistry,
  plugin?: WorkspacePlugin,
  ws?: Workspace,
  workspaceName?: string,
  config?: import("../plugins/types.js").WorkspaceConfigFile,
  pluginConfig?: unknown,
): Promise<void> {
  if (!state.workspace) return;
  const mcpServer = createMcpServer(state.workspace, registry, state.updates);

  // Register plugin MCP tools.
  if (plugin?.registerMcpTools && ws && workspaceName && config && pluginConfig !== undefined) {
    const ctx = buildPluginContext(workspaceName, ws, config, pluginConfig, state.updates, registry);
    plugin.registerMcpTools(mcpServer, ctx as WorkspacePluginContext);
  }

  // Mount plugin API routes.
  if (plugin?.createApiRoutes && ws && workspaceName && config && pluginConfig !== undefined) {
    const ctx = buildPluginContext(workspaceName, ws, config, pluginConfig, state.updates, registry);
    state.pluginRouter = plugin.createApiRoutes(ctx as WorkspacePluginContext);
  } else {
    state.pluginRouter = null;
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);
  state.mcpTransport = transport;
}

function buildPluginContext(
  workspaceName: string,
  workspace: Workspace,
  config: import("../plugins/types.js").WorkspaceConfigFile,
  pluginConfig: unknown,
  updates: EventEmitter,
  providerRegistry?: ProviderRegistry,
): WorkspacePluginContext<unknown> {
  return {
    workspaceName,
    workspace,
    config,
    pluginConfig,
    updates,
    providerRegistry: providerRegistry!,
  };
}

function teardownPlugin(state: AppState): void {
  for (const job of state.pluginJobs) {
    job.stop();
  }
  state.pluginJobs = [];
  state.activePlugin = null;
  state.pluginCtx = null;
  state.pluginRouter = null;
}

function startScheduler(state: AppState): void {
  if (!state.workspace) return;
  state.scheduler = startSourceScheduler(state.workspace, state.updates);
}

function stopScheduler(state: AppState): void {
  if (state.scheduler) {
    state.scheduler.stop();
    state.scheduler = null;
  }
}
