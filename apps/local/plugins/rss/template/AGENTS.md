# plugins/rss/template/

Parent: `../AGENTS.md`
Reads from: `../../../src/templates/{types,yaml}.js`, `raw:../components/*.tsx` (build-time inline).
Must never import from: `../server/`, `../ui/`, any other plugin.

## Purpose

Scaffold for `codoc init --from rss`. Exports `rssTemplate: Template`; the host runs `tmpl.files()`, validates each file via `validateTemplateContent`, and writes them into the new workspace.

Phase 2 will register this via `manifest.contributes.templates[].entry` rather than the current static aggregation in `src/templates/index.ts`.

## Constraints

- Pure data: no IO, no filesystem, no network, no `node:*` imports
- The components copied here are raw-text-inlined via `raw:../components/X.tsx` — the `raw:` resolver in `tsup.config.ts` walks back to `../components/` relative to this file's dirname; do not move files across these two directories without updating the import paths
- Files are written idempotently by `init.ts` (skips existing paths)
