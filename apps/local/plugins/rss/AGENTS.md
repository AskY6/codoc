# plugins/rss/

Parent: `../AGENTS.md`
Reads from: `../../src/domain/types.js`, `../../src/runtime/{workspace,service}.js`, `../../src/sources/{state,scheduler}.js`, `../../src/plugins-host/{manifest,context}.js`, `../../src/templates/{types,yaml}.js`. UI panels resolve `@/` (= `ui/src`) and `@plugins/` (= `plugins/`).
Must never import from: any other plugin, `@cobook/chat`, `@cobook/storage*`.

## Purpose

RSS reader plugin — owns the vertical product experience for RSS workspaces.

## Subtrees

- `server/` — node runtime: `activate(ctx)`, subscriptions, fetch, digest, ranking, AI summary, jobs, api routes, server commands (`rss.refresh`, `rss.digest`).
- `ui/` — browser entry: `activateUi(ctx)` registers MDX components + the UI-side `rss.subscribe` command; also exports panels mounted by the plugin-view registry.
- `components/` — MDX components (`ArticleList`, `DigestList`, `FeedHeader`, …) used inside `.codoc` bodies; bundled into the SPA and registered via `activateUi`.
- `template/` — `codoc init --from rss` scaffold; emits codocs only (components are plugin-shipped, no scaffold copy).
- `manifest.json` — Phase 2 manifest with full `contributes` block.
- `agent-prompt.md` — long-form agent system prompt, loaded by `server/index.ts` and re-exported as `rssAgentInstructions` (matches `manifest.contributes.agentInstructions`).

## Ownership boundary

Owns: **rss source provider** (`server/source-provider.ts`), template binding, article state API, UI manifest entries, agent instructions, config schema, legacy detection, digest ranking, auto-digest lifecycle.
Does NOT own: source scheduler (platform), codoc CRUD.

> The host wires `rssProvider` into the global `SourceRegistry` at boot via `apps/local/src/plugins-host/host.ts` (sourced from `manifest.contributes.sourceProviders[]` → `plugins-host/registry.ts`).
