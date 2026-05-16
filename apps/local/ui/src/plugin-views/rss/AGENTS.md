# plugin-views/rss/

Parent: `plugin-views/`
Reads from: `../../api.ts` (RSS types + REST client), `../../lib/event-bus.ts`, `@/components/ui/*` (shadcn primitives)
Must never import from: `../../App.tsx`, `../../components/ChatPanel.tsx`, `../../components/DocumentPanel.tsx`, backend code, other plugin subtrees

## Purpose

UI panels for RSS secondary views (`rss-subscriptions`, `rss-saved`) rendered by
App.tsx via `../registry.ts`. These are app-shell views (data from REST API),
not workspace-local MDX components.

## Files

- `FeedStatusBadge.tsx` — healthy / failing / never-fetched status pill
- `SubscriptionsPanel.tsx` — subscription list with health, stats, CRUD actions
- `SubscriptionForm.tsx` — add/edit dialog using radix Dialog
- `SavedArticlesPanel.tsx` — starred articles with search + source filter

## Constraints

- All data comes from `/api/plugins/rss/*` endpoints, never from codoc files directly
- Uses the same Tailwind utility patterns as sibling panels (ComponentPanel, GraphPanel)
- SSE subscription via `/api/updates` for live refresh, consistent with App.tsx pattern
- Components imported by `../registry.ts` must satisfy `PluginViewProps` (the
  `onSelectCodoc` prop may be ignored)
