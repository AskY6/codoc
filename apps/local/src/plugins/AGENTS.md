# src/plugins/

Parent: `apps/local/AGENTS.md`
Reads from: `../domain/types.js`, `../runtime/`, `../providers/registry.js`, `../templates/`, plus static imports of `../../plugins/<id>/server/index.js` from `registry.ts`.
Must never import from: `@cobook/core` internals beyond re-exported types, `packages/parser` internals, individual plugins (only `registry.ts` is allowed to).

## Purpose

Plugin **host** layer — the interface, registry, and detection used to wire concrete plugins (which live in `../../plugins/`) into the runtime.

## Files

- `types.ts` — `WorkspacePlugin` interface, config types, UI descriptor ADT
- `registry.ts` — static-imports `plugins/<id>/server/index.js` and exposes lookup by `workspaceKind`
- `config.ts` — parse raw `codoc.config.json` into typed `WorkspaceConfigFile`
- `detect.ts` — resolve active plugin: explicit config → auto-detect → default fallback

## Constraints

- Plugin implementations live in `apps/local/plugins/`, NOT here
- One workspace = one plugin (single `workspaceKind`, not a list)
- Compile-time registration via `registry.ts`; no dynamic loading
- Platform capabilities (source scheduler, codoc CRUD, DAG) stay in the host, not in plugins

## Roadmap

Phase 2 of `docs/plugin-architecture-v2.md` replaces `WorkspacePlugin` with manifest + `activate(ctx)` and moves registration to a `plugins-host/` subtree. This directory shrinks accordingly.
