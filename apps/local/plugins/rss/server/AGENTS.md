# plugins/rss/server/

Parent: `../AGENTS.md`
Reads from: `../../../src/{domain,runtime,sources,plugins-host}`, `@cobook/core`, `@cobook/parser`, `hono`, `undici`, `node:*`.
Must never import from: `../../ui/`, `../../components/`, any other plugin.

## Purpose

Node-side runtime of the RSS plugin. Entry exports consumed by `apps/local/src/plugins-host/registry.ts` per the `entry` pointers in `../manifest.json`.

## Public exports (from `index.ts`)

- `activate(ctx)` — per-workspace lifecycle. Registers REST routes (`ctx.routes.use`) and the digest job (`ctx.jobs.start`).
- `rssProvider`, `RssArticle` — source provider for `$source: rss`.
- `parseRssConfig`, `RssPluginConfig` — typed plugin config.
- `detectRssWorkspace` — legacy detector (`manifest.contributes.legacyDetect`).
- `rssTemplate` — re-export of `../template/index.ts` for the manifest entry.
- `rssAgentInstructions` — pre-loaded contents of `../agent-prompt.md`.

## Internal files

- `config.ts` — `RssPluginConfig` schema + `parseRssConfig()`.
- `detect.ts` — heuristic for legacy workspaces (inbox.codoc + `$source: rss`).
- `api-routes.ts` — article state PATCH, feed refresh, digest generation routes; takes a `RssServiceContext`.
- `service.ts` — domain logic: `refreshFeeds()`, `generateDigest()`, subscriptions CRUD.
- `subscription.ts` — `Subscription` read model builder from codoc AST + source-state.
- `ranking.ts` — multi-signal article scoring.
- `ai-summary.ts` — optional AI digest summary via Anthropic API.
- `digest-job.ts` — background auto-digest with catch-up on workspace open; consumes `RssServiceContext`.
- `article-fetch.ts` — readable-body fetcher via r.jina.ai.
- `source-provider.ts` — RSS / Atom XML parser implementing `SourceProvider`.

## Constraints

- `index.ts` is the only file the host imports — all other modules stay private to this subtree.
- No direct dependency on `src/server/`; cross-cuts (event bus, MCP server) flow through `ActivateContext`.
