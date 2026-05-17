# server/

Parent: `apps/local/src/`
Reads from: `../domain/`, `../runtime/`, `../sources/`, `../providers/`, `../plugins-host/`, `../templates/types.js`, `../commands/init.js`
Must never import from: `@cobook/service`, `@cobook/storage`, `@cobook/chat`, `@cobook/graph`, `ui/`, or any concrete plugin (`../../plugins/*`).

## Purpose

Runtime servers and HTTP routing. Wires the workspace into Hono (HTTP+MCP+SSE) and stdio MCP, delegates plugin lifecycle to `../plugins-host/`, and serves the SPA.

## Key files

- `http.ts` — Hono server: `/api/workspaces`, `/api/*`, `/mcp` (StreamableHTTP), static SPA. Owns watcher + scheduler lifecycle and holds the `PluginHost` instance. Entry from `index.ts` for `codoc start`.
- `mcp.ts` — MCP tool server on stdio for Claude Code subprocess (`codoc mcp`) and the in-process MCP transport mounted by `http.ts`. Plugin-contributed MCP tools attach to the server through `ctx.mcp.registerTool` during `activate(ctx)`.
- `api-routes.ts` — REST routes for the local web UI (workspace CRUD, recognition, chat metadata).
- `chat-route.ts` — SSE proxy to CLI providers (`POST /api/chat`). Pulls plugin agent prompt from `PluginHost.activeAgentInstructions()`.
- `chat-meta.ts` — `<sourceDir>/chats.json` persistence (just enough to list past conversations; full history lives in each CLI's native storage).

## Constraints

- No state of its own beyond `AppState` — every mutation goes through `../runtime/service.js`.
- Plugin routes mount under `/api/plugins/<pluginId>/*` via `PluginHost.activeRouter()`; the server knows nothing about RSS or any other vertical.
- `chat-route.ts` never persists message bodies — only metadata via `chat-meta.ts`.
