# server/

Parent: `apps/local/src/`
Reads from: `../workspace/`, `../sources/`, `../providers/`, `../plugins/`, `../templates/`, `../commands/init.js`
Must never import from: `@cobook/service`, `@cobook/storage`, `@cobook/chat`, `@cobook/graph`, `ui/`

## Purpose

Runtime servers and HTTP routing. Wires the workspace into Hono (HTTP+MCP+SSE)
and stdio MCP, mounts plugin routes, and serves the SPA.

## Key files

- `http.ts` — Hono server: `/api/workspaces`, `/api/*`, `/mcp` (StreamableHTTP),
  static SPA. Owns watcher + scheduler lifecycle. Entry from `index.ts` for
  `codoc start`.
- `mcp.ts` — MCP tool server on stdio for Claude Code subprocess (`codoc mcp`)
  and the in-process MCP transport mounted by `http.ts`.
- `api-routes.ts` — REST routes for the local web UI (workspace CRUD,
  recognition, chat metadata).
- `chat-route.ts` — SSE proxy to CLI providers (`POST /api/chat`).
- `chat-meta.ts` — `<sourceDir>/chats.json` persistence (just enough to list
  past conversations; full history lives in each CLI's native storage).

## Constraints

- No state of its own — every mutation goes through `../workspace/service.js`.
- Plugin routes are mounted via `WorkspacePlugin.createApiRoutes`; the server
  knows nothing about RSS or any other vertical.
- `chat-route.ts` never persists message bodies — only metadata via `chat-meta.ts`.
