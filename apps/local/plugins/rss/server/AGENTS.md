# plugins/rss/server/

Parent: `../AGENTS.md`
Reads from: `../../../src/{domain,runtime,sources,plugins/types}`, `@cobook/core`, `@cobook/parser`, `hono`, `undici`, `node:*`.
Must never import from: `../../ui/`, `../../components/`, any other plugin.

## Purpose

Node-side runtime of the RSS plugin. Mounted by `src/plugins/registry.ts`; the host calls `WorkspacePlugin` hooks (`createApiRoutes`, `startJobs`, `getUiSpec`, `getAgentInstructions`, `parseConfig`, `detectWorkspace`).

## Key files

- `index.ts` — assembles all plugin hooks into a `WorkspacePlugin<RssPluginConfig>`; imports `rssTemplate` from `../template/`
- `config.ts` — `RssPluginConfig` schema + `parseRssConfig()`
- `detect.ts` — heuristic for legacy workspaces (inbox.codoc + `$source: rss`)
- `api-routes.ts` — article state PATCH, feed refresh, digest generation routes
- `service.ts` — domain logic: `refreshFeeds()`, `generateDigest()`, subscriptions CRUD
- `subscription.ts` — `Subscription` read model builder from codoc AST + source-state
- `ui.ts` — `WorkspaceUiSpec` for inbox-first layout + domain actions (Phase 3 replaces this with commands + menus)
- `ranking.ts` — multi-signal article scoring
- `ai-summary.ts` — optional AI digest summary via Anthropic API
- `digest-job.ts` — background auto-digest with catch-up on workspace open
- `article-fetch.ts` — readable-body fetcher via r.jina.ai
