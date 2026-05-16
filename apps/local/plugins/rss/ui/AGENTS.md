# plugins/rss/ui/

Parent: `../AGENTS.md`
Reads from: `react`, `@/api.ts`, `@/lib/event-bus.ts`, `@/components/ui/*` (shadcn primitives in the SPA shell). Sibling panels resolve via `./`.
Must never import from: `../server/`, `../components/`, `../template/`, any other plugin.

## Purpose

Browser-side bundle of the RSS plugin. Today it is a static module re-exporting React components from `panels/`; the SPA shell's `ui/src/plugin-views/registry.ts` imports `@plugins/rss/ui/index.ts` and wires panels into `uiSpec.secondaryViews`.

Phase 2 replaces this static export with `activateUi(ctx)` and dynamic registration via `ctx.views.registerView(viewId, Component)`.

## Files

- `index.ts` — re-exports `SubscriptionsPanel` and `SavedArticlesPanel`
- `panels/SubscriptionsPanel.tsx` — list / add / edit feeds
- `panels/SavedArticlesPanel.tsx` — starred articles across feeds
- `panels/SubscriptionForm.tsx` — modal dialog used by SubscriptionsPanel
- `panels/FeedStatusBadge.tsx` — status pill, shared between subscription rows
