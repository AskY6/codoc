# ui/src/plugin-views/

Parent: `ui/src/`
Reads from: `./<pluginId>/` (panel components), React, `../api.ts` (transitive via plugin subdirs)
Must never import from: `../App.tsx`, backend code

## Purpose

Bridge between the SPA and plugin-owned panels. Panel components themselves now
live under `apps/local/plugins/<id>/ui/`; this directory only holds the registry
that maps `(pluginId, viewId)` → React component so `App.tsx` can render entries
from `uiSpec.secondaryViews` without per-plugin branches.

The browser bundle and the server-side plugin code do not share an ESM graph, so
registry entries are added at build time by importing from each plugin's `ui/`
entry — there is no dynamic registration in Phase 1.

## Files

- `registry.ts` — imports from `@plugins/<id>/ui/index.ts` and maps each plugin's panels by view id.

## Contract

- A plugin that lists `{ id: "<view-id>", … }` in its `contributes.ui.secondaryViews`
  (the canonical and only declaration site — `contributes.views` was removed)
  must export the corresponding component from its `ui/index.ts` and be wired here.
- Components accept `PluginViewProps { onSelectCodoc: (path: string) => void }`.
  Components that don't need the prop may ignore it.
- If a `secondaryViews` entry has no registry entry, App.tsx renders an empty
  state — the nav button stays usable, the body shows "View not registered".

## Constraints

- Imports use the `@plugins` alias (configured in `ui/vite.config.ts` and `ui/tsconfig.json`).
- `registry.ts` is the only file in `ui/src` allowed to import from `@plugins/*/ui/*` — keep cross-plugin coupling out of `App.tsx`.

## Roadmap

Phase 2 replaces this static registry with `activateUi(ctx)`-driven registration; plugins will call `ctx.views.registerView(viewId, Component)` and this file goes away.
