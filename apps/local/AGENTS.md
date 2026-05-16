# @cobook/local

Parent: `apps/`
Reads from: `@cobook/core`, `@cobook/parser` (parser + source registry), `@cobook/compiler`
Must never import from: `@cobook/service`, `@cobook/storage`, `@cobook/storage-memory`, `@cobook/storage-pg`, `@cobook/chat`, `@cobook/graph`

## Purpose

Local file-based codoc server. CLI commands:
- `codoc` (default) — unified mode: HTTP server + watch + MCP (StreamableHTTP)
- `codoc init` — scaffold `.codoc/` directory + `codoc.config.json`
- `codoc mcp` — MCP stdio server (Claude Code spawns this as subprocess)
- `codoc compile` — one-shot compile
- `codoc dag` — print DAG

## Subtrees

- `src/domain/` — pure: Workspace / LocalCodoc types, resolve / diagnose / recognize / patch, custom-component types.
- `src/runtime/` — side-effectful: workspace IO, mutation service, chokidar watcher, esbuild component scanner.
- `src/sources/` — periodic `$source` refresh + `.source-state.json` persistence.
- `src/server/` — HTTP / MCP / SSE servers and REST routes.
- `src/commands/` — one-shot CLI subcommands (`init`, `add`) and the component catalog.
- `src/plugins/` — workspace plugin system (RSS, default).
- `src/providers/` — chat provider adapters (Claude Code, Codex, Kiro).
- `src/templates/` — built-in workspace templates for `codoc init --from`.
- `ui/` — Local web UI (Vite + React SPA). See `ui/AGENTS.md`.

## Architecture

```
Browser  ←→  Hono HTTP server (:4321)
               ├── /api/*     REST API (workspace CRUD)
               ├── /mcp       MCP StreamableHTTP transport
               └── /*         Static SPA (React, built by Vite from ui/)
                      ↕
AI Client (Claude Code)  ←→  stdio MCP  (`codoc mcp`, separate process)

Both modes share:
  sourceDir/**/*.codoc  →  parse  →  resolve ($ref, $source)  →  compile  →  *.mdx
  chokidar watch  →  debounced rebuild (300ms)
```

## Custom components

Users create `.tsx` files in `.codoc/components/`. The server:
1. Scans and compiles them to CJS via esbuild (react externalized)
2. Serves compiled code via `GET /api/components`
3. Watches `.tsx` changes and recompiles (via chokidar, same watcher as codocs)

The client evaluates CJS in-browser with a mock `require()` that provides
react from the app's loaded modules, then merges custom components with
built-ins for MDX rendering and the component panel.

Key files: `src/runtime/components.ts` (scanner/compiler), `src/domain/components.ts` (entry types), `ui/src/custom-components.ts` (evaluator/hook).

## Key decisions

- No storage layer — files ARE the persistence
- No thread/agent/session stores — Claude Code owns conversation state
- Resolution is workspace-global (all siblings participate in DAG)
- Compile output is self-contained .mdx (data exported as ES module)
- Watch uses debounced rebuild (300ms) for batch saves
- Unified `codoc` command starts HTTP + watch + MCP on same process
- MCP stdio (`codoc mcp`) stays separate for Claude Code subprocess model
- `codoc init` is idempotent — skips existing files/dirs
- Custom component metadata via optional `export const meta` convention
