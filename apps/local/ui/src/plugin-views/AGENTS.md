# ui/src/plugin-views/

Parent: `ui/src/`
Reads from: `./<pluginId>/` (panel components), React, `../api.ts` (transitive via plugin subdirs)
Must never import from: `../App.tsx`, backend code

## Purpose

Plugin-owned secondary-view UI lives here, one subdirectory per plugin id. The
top-level `registry.ts` maps `(pluginId, viewId)` → React component so App.tsx
can render entries from `uiSpec.secondaryViews` without per-plugin branches.

The browser bundle and the server-side plugin code do not share an ESM graph,
so registry entries are added by editing `registry.ts` at build time — there is
no dynamic registration.

## Layout

```
plugin-views/
  registry.ts            ← imports + maps each plugin's components
  AGENTS.md              ← this file
  <pluginId>/
    AGENTS.md            ← per-plugin constraints
    *.tsx                ← panel components
```

## Contract

- A plugin that lists `{ id: "<view-id>", … }` in its `uiSpec.secondaryViews` must
  add an entry to `pluginViewRegistry[<pluginId>][<view-id>]`.
- Components accept `PluginViewProps { onSelectCodoc: (path: string) => void }`.
  Components that don't need the prop may ignore it.
- If a `secondaryViews` entry has no registry entry, App.tsx renders an empty
  state — the nav button stays usable, the body shows "View not registered".

## Constraints

- `registry.ts` is the only file in this directory that is allowed to import
  from `./<pluginId>/*` — keep cross-plugin coupling out of `App.tsx`.
- New plugin → new top-level subdirectory + new top-level key in
  `pluginViewRegistry`. Don't nest pluginId inside view-id strings.
