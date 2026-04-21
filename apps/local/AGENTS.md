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

## Architecture

```
Browser (Phase 1)  ←→  Hono HTTP server (:4321)
                         ├── GET /         health check
                         └── ALL /mcp      MCP StreamableHTTP transport
                                ↕
AI Client (Claude Code)  ←→  stdio MCP  (`codoc mcp`, separate process)

Both modes share:
  sourceDir/**/*.codoc  →  parse  →  resolve ($ref, $source)  →  compile  →  *.mdx
  chokidar watch  →  debounced rebuild (300ms)
```

## Key decisions

- No storage layer — files ARE the persistence
- No thread/agent/session stores — Claude Code owns conversation state
- Resolution is workspace-global (all siblings participate in DAG)
- Compile output is self-contained .mdx (data exported as ES module)
- Watch uses debounced rebuild (300ms) for batch saves
- Unified `codoc` command starts HTTP + watch + MCP on same process
- MCP stdio (`codoc mcp`) stays separate for Claude Code subprocess model
- `codoc init` is idempotent — skips existing files/dirs
