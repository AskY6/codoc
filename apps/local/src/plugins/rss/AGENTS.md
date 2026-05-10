# plugins/rss/

Parent: `plugins/`
Reads from: `../types.ts`, `../../workspace-service.js`, `../../templates/rss.js`, `../../source-scheduler.js` (public helpers only)
Must never import from: `../default/`

## Purpose

RSS reader plugin — owns the vertical product experience for RSS workspaces.

## Key files

- `index.ts` — assembles all plugin hooks into a `WorkspacePlugin<RssPluginConfig>`
- `config.ts` — `RssPluginConfig` schema + `parseRssConfig()`
- `detect.ts` — heuristic for legacy workspaces (inbox.codoc + $source "rss")
- `template.ts` — re-exports `rssTemplate` from `templates/rss.ts`
- `api-routes.ts` — article state PATCH, feed refresh, digest generation routes
- `service.ts` — domain logic: `refreshFeeds()`, `generateDigest()`
- `ui.ts` — `WorkspaceUiSpec` for inbox-first layout + domain actions

## Ownership boundary

Owns: template binding, article state API, UI descriptor, agent instructions, config schema, legacy detection.
Does NOT own: `rssProvider` (parser layer), source scheduler (platform), codoc CRUD.
