# plugins/

Parent: `apps/local/src/`
Reads from: `../workspace.js`, `../workspace-service.js`, `../providers/registry.js`, `../templates/`
Must never import from: `@cobook/core` internals beyond re-exported types, `packages/parser` internals

## Purpose

Workspace plugin system. A `WorkspacePlugin` is a vertical capability pack that owns domain-specific runtime for a workspace kind (e.g. RSS, bookmarks).

## Key files

- `types.ts` — `WorkspacePlugin` interface, config types, UI descriptor ADT
- `registry.ts` — built-in plugin registry, lookup by `workspaceKind`
- `config.ts` — parse raw `codoc.config.json` into typed `WorkspaceConfigFile`
- `detect.ts` — resolve active plugin: explicit config → auto-detect → default fallback

## Children

- `default/` — no-op fallback plugin
- `rss/` — RSS reader plugin (first vertical)

## Constraints

- Plugins live in app layer only; never push plugin concepts into `@cobook/core` or `@cobook/parser`
- One workspace = one plugin (single `workspaceKind`, not a list)
- Compile-time registration via `registry.ts`; no dynamic loading
- Platform capabilities (source scheduler, codoc CRUD, DAG) stay in the host, not in plugins
