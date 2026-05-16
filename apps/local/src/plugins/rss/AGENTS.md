# plugins/rss/

Parent: `plugins/`
Reads from: `../types.ts`, `../../workspace-service.js`, `../../templates/rss.js`, `../../source-scheduler.js` (public helpers only)
Must never import from: `../default/`, `@cobook/chat`

## Purpose

RSS reader plugin — owns the vertical product experience for RSS workspaces.

## Key files

- `index.ts` — assembles all plugin hooks into a `WorkspacePlugin<RssPluginConfig>`
- `config.ts` — `RssPluginConfig` schema + `parseRssConfig()`
- `detect.ts` — heuristic for legacy workspaces (inbox.codoc + $source "rss")
- `template.ts` — re-exports `rssTemplate` from `templates/rss.ts`
- `api-routes.ts` — article state PATCH, feed refresh, digest generation routes
- `service.ts` — domain logic: `refreshFeeds()`, `generateDigest()`, subscriptions CRUD
- `subscription.ts` — `Subscription` read model builder from codoc AST + source-state
- `ui.ts` — `WorkspaceUiSpec` for inbox-first layout + domain actions
- `ranking.ts` — multi-signal article scoring (recency + starred + description quality + source diversity)
- `ai-summary.ts` — optional AI digest summary enhancement via Anthropic API; graceful no-op when unavailable
- `digest-job.ts` — background auto-digest job with catch-up on workspace open

## Ownership boundary

Owns: template binding, article state API, UI descriptor, agent instructions, config schema, legacy detection, digest ranking, auto-digest lifecycle.
Does NOT own: `rssProvider` (parser layer), source scheduler (platform), codoc CRUD.
