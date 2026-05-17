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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Workspace } from "../domain/types.js";
import { loadWorkspace, compileAll } from "../runtime/workspace.js";
import { createApiRoutes } from "./api-routes.js";
import { createChatRoutes } from "./chat-route.js";
import { createMcpServer } from "./mcp.js";
import { startWatcher } from "../runtime/watcher.js";
import { startSourceScheduler } from "../sources/scheduler.js";
import type { SourceScheduler } from "../sources/scheduler.js";
import { createProviderRegistry } from "../providers/registry.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { initWorkspace } from "../commands/init.js";
import { PluginHost } from "../plugins-host/host.js";
import { parseWorkspaceConfig } from "../plugins-host/manifest.js";

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
  mcpServer: McpServer | null;
  watcher: { close: () => Promise<void> } | null;
  scheduler: SourceScheduler | null;
  readonly pluginHost: PluginHost;
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

  const pluginHost = new PluginHost();

  const state: AppState = {
    workspace: options.initialWorkspace?.workspace ?? null,
    workspaceName: options.initialWorkspace?.name ?? null,
    mcpTransport: null,
    mcpServer: null,
    watcher: null,
    scheduler: null,
    pluginHost,
    updates: new EventEmitter(),
  };

  // Detect available CLI providers in parallel.
  const registry = await createProviderRegistry();
  const availableNames = registry.info
    .filter((p) => p.available)
    .map((p) => p.name);
  console.log(`[codoc] providers: ${availableNames.length > 0 ? availableNames.join(", ") : "none detected"}`);

  // If initial workspace provided, set up MCP, watcher, source scheduler, and activate plugin.
  if (state.workspace && options.initialWorkspace) {
    const wsName = options.initialWorkspace.name;
    await openWorkspaceState(state, registry, wsName, state.workspace, /* alreadyLoaded */ true);
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
    const mod = state.pluginHost.activeModule();
    const contributes = mod?.manifest.contributes;
    return c.json({
      active: true,
      name: state.workspaceName,
      codocCount: state.workspace.codocs.size,
      pluginId: mod?.manifest.id ?? "default",
      uiSpec: contributes?.ui,
      commands: contributes?.commands ?? [],
      menus: contributes?.menus ?? {},
      mdxComponents: contributes?.mdxComponents ?? [],
      // Phase 5: surface commands from every installed plugin so the palette
      // can list them. v1 only runs the active plugin's commands; UI shows
      // others as disabled with a "switch workspace" hint.
      allCommands: state.pluginHost.allCommands(),
      // Typed plugin config — same object passed to server-side activate(ctx).
      // UI's activateUi(ctx) receives this verbatim so browser-side code can
      // honour user settings (e.g. RSS panel knowing the digestCodocPath).
      pluginConfig: state.pluginHost.activeConfig(),
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

    await teardownWorkspace(state);

    // Read workspace config.
    let rawConfig: Record<string, unknown> = {};
    let outDir = workspaceDir;
    try {
      rawConfig = JSON.parse(
        await readFile(join(workspaceDir, "codoc.config.json"), "utf-8"),
      ) as Record<string, unknown>;
      if (typeof rawConfig.outDir === "string") outDir = resolve(workspaceDir, rawConfig.outDir);
    } catch { /* use defaults */ }

    // Load workspace using the host-global SourceRegistry.
    const ws = await loadWorkspace(workspaceDir, outDir, state.pluginHost.sourceRegistry);
    await compileAll(ws);

    state.workspace = ws;
    state.workspaceName = name;

    await openWorkspaceState(state, registry, name, ws, /* alreadyLoaded */ false, rawConfig);

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
      await teardownWorkspace(state);
      state.workspace = null;
      state.workspaceName = null;
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
      state.pluginHost.templates.map((t) => ({
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

    const template = state.pluginHost.findTemplate(templateId);
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
    const ws = await loadWorkspace(workspaceDir, outDir, state.pluginHost.sourceRegistry);
    await compileAll(ws);

    await teardownWorkspace(state);

    state.workspace = ws;
    state.workspaceName = name;

    await openWorkspaceState(state, registry, name, ws, /* alreadyLoaded */ false);

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

  // ---- Plugin command bus (POST /api/plugins/:pluginId/commands/:cmdId) ---
  //
  // Server-side commands are registered via ctx.commands.registerCommand(...)
  // during plugin activate(). The UI host dispatches here over HTTP.
  app.post("/api/plugins/:pluginId/commands/:cmdId", async (c) => {
    const pluginId = c.req.param("pluginId");
    const cmdId = c.req.param("cmdId");

    const handler = state.pluginHost.activeCommand(pluginId, cmdId);
    if (!handler) {
      return c.json(
        { ok: false, error: `command "${cmdId}" not registered on plugin "${pluginId}"` },
        404,
      );
    }

    let args: unknown = undefined;
    try {
      const text = await c.req.text();
      if (text.length > 0) args = JSON.parse(text);
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" }, 400);
    }

    try {
      const result = await handler(args);
      return c.json({ ok: true, result: result ?? null });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  // ---- Plugin API routes (dynamic — delegates to active plugin) ----------
  app.all("/api/plugins/:pluginId/*", async (c) => {
    const pluginId = c.req.param("pluginId");
    const activeMod = state.pluginHost.activeModule();
    if (!activeMod || activeMod.manifest.id !== pluginId) {
      return c.json({ error: `plugin "${pluginId}" not active` }, 404);
    }
    const router = state.pluginHost.activeRouter();
    if (!router) {
      return c.json({ error: "plugin has no API routes" }, 404);
    }
    // Strip prefix so plugin routes match against "/" + relative path.
    const prefix = `/api/plugins/${pluginId}`;
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(prefix.length) || "/";
    const rewritten = new Request(url.toString(), c.req.raw);
    return router.fetch(rewritten);
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

  return new Promise((resolvePromise) => {
    const server = serve({ fetch: app.fetch, port: actualPort }, (info) => {
      console.log(`[codoc] server listening on http://localhost:${info.port}`);
      console.log(`[codoc] MCP endpoint: http://localhost:${info.port}/mcp`);
      if (hasUi) {
        console.log(`[codoc] UI: http://localhost:${info.port}`);
      }
      resolvePromise({ port: info.port, close: () => server.close() });
    });
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close();
      resolvePromise(true);
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

/**
 * Common path for "a workspace is now state.workspace; set up runtime".
 * Activates the plugin, wires MCP, starts watcher + scheduler, awaits the
 * first source-refresh tick (so jobs see articles), then lets the plugin
 * register its own jobs.
 */
async function openWorkspaceState(
  state: AppState,
  registry: ProviderRegistry,
  workspaceName: string,
  ws: Workspace,
  alreadyLoaded: boolean,
  rawConfigOverride?: Record<string, unknown>,
): Promise<void> {
  // Read config.
  let rawConfig: Record<string, unknown> = rawConfigOverride ?? {};
  if (!rawConfigOverride) {
    try {
      rawConfig = JSON.parse(
        await readFile(join(ws.sourceDir, "codoc.config.json"), "utf-8"),
      ) as Record<string, unknown>;
    } catch { /* */ }
  }
  const config = parseWorkspaceConfig(rawConfig);

  // Resolve plugin.
  const { module: mod, source } = state.pluginHost.resolvePlugin(ws, config);
  const cfgResult = state.pluginHost.parsePluginConfig(mod, config.pluginConfig);
  if (cfgResult.error) {
    console.warn(
      `[plugin-host] config error for "${mod.manifest.id}", falling back to defaults: ${cfgResult.error}`,
    );
  }
  console.log(`[plugin-host] activated: ${mod.manifest.id} (${source})`);

  // Build a fresh MCP server (host tools + plugin tools).
  const mcpServer = createMcpServer(ws, registry, state.updates);

  // Activate the plugin — registers routes, jobs, mcp tools through ctx.
  await state.pluginHost.activate({
    module: mod,
    pluginConfig: cfgResult.value,
    workspaceName,
    workspace: ws,
    providers: registry,
    updates: state.updates,
    mcpServer,
  });

  // Wire MCP transport to the host's mcp server.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);
  state.mcpServer = mcpServer;
  state.mcpTransport = transport;

  // Watcher + source scheduler.
  state.watcher = startWatcher(ws);
  state.scheduler = startSourceScheduler(ws, state.updates);
  if (state.scheduler) {
    await Promise.race([
      state.scheduler.ready,
      new Promise<void>((r) => setTimeout(r, 10_000)),
    ]);
  }

  void alreadyLoaded;
}

/** Tear down everything that depends on the current workspace. Idempotent. */
async function teardownWorkspace(state: AppState): Promise<void> {
  state.pluginHost.deactivate();
  if (state.scheduler) {
    state.scheduler.stop();
    state.scheduler = null;
  }
  if (state.watcher) {
    await state.watcher.close();
    state.watcher = null;
  }
  state.mcpTransport = null;
  state.mcpServer = null;
}
