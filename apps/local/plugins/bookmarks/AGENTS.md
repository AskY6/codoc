# plugins/bookmarks/

Parent: `../AGENTS.md`
Reads from: `../../src/templates/{types,yaml}.js`. Uses `raw:` import for its own component.
Must never import from: any other plugin, `@cobook/storage*`, `@cobook/chat`.

## Purpose

Minimal template-only plugin. Contributes the **bookmarks** workspace template (a starter set of structured web clippings + reading-list dashboard). Has no `server/` or `ui/` — when a user picks this template, the workspace gets no `workspaceKind` and the runtime falls back to the default no-op plugin.

## Files

- `manifest.json` — declares the single template contribution
- `template/index.ts` — the `Template` object (files + components catalog)
- `template/components/BookmarkCard.tsx` — MDX component bundled into scaffold output

## Constraints

- No `activate(ctx)` — host treats this plugin as inert.
- No `legacyDetect` — workspaces created from this template stay unbound at the plugin-resolution layer.
