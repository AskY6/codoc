# components/rss/

Parent: `components/`
Reads from: `../../api.ts` (RSS types + API client), `../ui/` (shadcn primitives)
Must never import from: `../ChatPanel.tsx`, `../DocumentPanel.tsx`, backend code

## Purpose

RSS-specific UI panels rendered as plugin views in the center panel.
These are app-shell views (data from REST API), not workspace-local MDX components.

## Key files

- `FeedStatusBadge.tsx` — healthy / failing / never-fetched status pill
- `SubscriptionsPanel.tsx` — subscription list with health, stats, CRUD actions
- `SubscriptionForm.tsx` — add/edit dialog using radix Dialog
- `SavedArticlesPanel.tsx` — starred articles with search + source filter

## Constraints

- All data comes from `/api/plugins/rss/*` endpoints, never from codoc files directly
- Components use the same Tailwind utility patterns as sibling panels (ComponentPanel, GraphPanel)
- SSE subscription via `/api/updates` for live refresh, consistent with App.tsx pattern
