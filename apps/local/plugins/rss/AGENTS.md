# plugins/rss/

Parent: `../AGENTS.md`
Reads from: `../../src/domain/types.js`, `../../src/runtime/{workspace,service}.js`, `../../src/sources/{state,scheduler}.js`, `../../src/plugins/types.js`, `../../src/templates/{types,yaml}.js`. UI panels resolve `@/` (= `ui/src`) and `@plugins/` (= `plugins/`).
Must never import from: any other plugin, `@cobook/chat`, `@cobook/storage*`.

## Purpose

RSS reader plugin — owns the vertical product experience for RSS workspaces.

## Subtrees

- `server/` — node runtime (subscriptions, fetch, digest, ranking, AI summary, jobs, api routes)
- `ui/` — browser panels mounted by the SPA's plugin-view registry
- `components/` — MDX components (`ArticleList`, `DigestList`, `FeedHeader`, …) used inside `.codoc` bodies; bundled as raw TSX strings by the template scaffold today
- `template/` — `codoc init --from rss` scaffold; raw-imports siblings from `../components/`
- `manifest.json` — metadata only in Phase 1

## Ownership boundary

Owns: **rss source provider** (`server/source-provider.ts`, exported from `server/index.ts`), template binding, article state API, UI descriptor, agent instructions, config schema, legacy detection, digest ranking, auto-digest lifecycle.
Does NOT own: source scheduler (platform), codoc CRUD.

> The host wires `rssProvider` into the runtime `SourceRegistry` at boot via `apps/local/src/plugins/source-registry.ts`. Phase 2 replaces this hardcoded import with a manifest-driven entry pointer.
