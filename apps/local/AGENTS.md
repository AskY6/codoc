# @cobook/local

Parent: `apps/`
Reads from: `@cobook/core`, `@cobook/parser` (parser + source registry), `@cobook/compiler`
Must never import from: `@cobook/service`, `@cobook/storage`, `@cobook/storage-memory`, `@cobook/storage-pg`, `@cobook/chat`, `@cobook/graph`

## Purpose

Local file-based codoc server. Three modes:
- `watch` — file watcher + auto-compile to .mdx
- `mcp` — MCP stdio server for Claude Code integration
- `compile` — one-shot compile

## Architecture

```
sourceDir/**/*.codoc  →  parse  →  resolve ($ref, $source)  →  compile  →  .codoc/compiled/*.mdx
                                                                            ↑ VSCode MDX preview
Claude Code  ←→  MCP stdio  ←→  read/write/list/search/dag tools
```

## Key decisions

- No storage layer — files ARE the persistence
- No thread/agent/session stores — Claude Code owns conversation state
- Resolution is workspace-global (all siblings participate in DAG)
- Compile output is self-contained .mdx (data exported as ES module)
- Watch uses debounced rebuild (300ms) for batch saves
