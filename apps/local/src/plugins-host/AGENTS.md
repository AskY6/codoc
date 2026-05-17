# src/plugins-host/

Parent: `apps/local/AGENTS.md`
Reads from: `../domain/types.js`, `../templates/types.js`, `../providers/registry.js`, `@cobook/parser` (SourceRegistry), `hono`, MCP SDK, plus compile-time imports of each `plugins/<id>/{manifest.json, server/index.ts, template/index.ts}`.
Must never import from: any plugin via its internal subtrees (only `<id>/server/index.js` and `<id>/template/index.js` are public surface), `../server/`, `@cobook/storage*`, `@cobook/chat`, `@cobook/graph`.

## Purpose

Phase 2 plugin runtime. Replaces the v1 `WorkspacePlugin` interface with manifest + `activate(ctx)`.

The host:

1. Reads each `plugins/<id>/manifest.json` at boot (compile-time imports via `registry.ts`).
2. Registers **static contributions** (sourceProviders, templates, legacyDetect, agentInstructions) before any workspace loads.
3. On workspace open, resolves the matching plugin (`workspaceKind` first, then `legacyDetect`), validates `pluginConfig`, and calls `activate(ctx)`.
4. Collects router + jobs + MCP tools the plugin registers through `ctx`, returns the activation handle, and disposes everything on workspace close.

## Files

- `manifest.ts` — `Manifest` JSON shape, `WorkspaceConfigFile`, `parseWorkspaceConfig`, UI descriptor ADT, `PluginConfigError`.
- `disposable.ts` — `Disposable`, `DisposableStore`, `toDisposable`.
- `context.ts` — `ActivateContext` shape + factory; records routes/jobs/mcp registrations into an `ActivationResult`.
- `registry.ts` — compile-time module list mapping each manifest to its statically-imported `activate` / `sourceProviders` / `templates` / `legacyDetect` / `parseConfig` / `agentInstructions` bindings. tsup walks these imports.
- `host.ts` — `PluginHost` class: source registry assembly, template aggregation, `resolvePlugin`, `parsePluginConfig`, `activate`, `deactivate`.

## Constraints

- One workspace = one active plugin (single `workspaceKind`, not a list).
- Source providers register **host-global**, not per-workspace — they sit outside any `DisposableStore`. Provider invocation only happens when a codoc declares `$source: <scheme>`.
- Per-workspace resources (HTTP router, jobs, event listeners) flow through `ctx.subscriptions` (`DisposableStore`) and dispose on workspace close.
- `entry: "server/sources.ts#rssProvider"` strings in manifests are documentation in v1; resolution is compile-time via `registry.ts`. Phase 6 replaces this file with a manifest-driven dynamic-import loader.
- v1 doesn't ajv-validate `contributes.configurationSchema`; each plugin keeps its own narrow validator (exported as `parseConfig` from the entry pointer).
- `parsePluginConfig` always returns a usable `value` — on validation failure it re-runs `parseConfig(undefined)` to get the plugin's declared DEFAULTS rather than passing `{}` to `activate(ctx)`. The error is surfaced via the `error` field so callers can log; the host never refuses activation over a config error. This means plugin code can always assume `ctx.config` is a fully-typed object, not an untyped fallback.

## Phase 3+ extensions

- `commands` namespace on `ActivateContext` + manifest `contributes.commands` / `menus` (Phase 3).
- `mdxComponents` registration in browser-side `activateUi(ctx)` (Phase 4).

## Phase 5 — ActivationEvents (landed)

- `manifest.activationEvents` is parsed via `parseActivationEvent` (manifest.ts) into an ADT: `workspaceKind | command | startupFinished | unknown`.
- `resolvePlugin` consults `onWorkspaceKind:<id>` events first when `workspaceKind` is set. Falls back to id-match (with a warn, so authors notice the missing event) and then to `legacyDetect`, preserving back-compat for plugins that haven't declared events yet.
- `PluginHost` tracks a per-plugin `PluginState` (`installed → activated → disposed`) seeded `installed` for every known manifest. Transitions log as `[plugin-host] <id>: prev → next` on workspace open/close. `onStartupFinished` events emit an observability log line but don't activate (single-plugin-per-workspace invariant holds).
- `onCommand:<id>` is parsed but does not auto-activate — same invariant. The command palette uses `host.allCommands()` to list every plugin's commands; inactive ones render disabled with a "switch workspace" hint.
