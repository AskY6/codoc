# templates/

Parent: `apps/local/AGENTS.md`
Reads from: nothing (this directory is now type-only).
Must never import from: `../runtime/`, `../server/`, `../sources/`, or any concrete plugin.

## Purpose

Shared template types + the YAML serializer. After Phase 2, **templates themselves are owned by plugins** — each plugin contributes its templates via `manifest.contributes.templates[]`, and `PluginHost` aggregates them into a host-global registry.

## Files

- `types.ts` — `Template`, `TemplateFile`, legacy `Command` / `QuickAction` shapes.
- `yaml.ts` — Shared YAML serializer used by plugin template modules (no runtime dependency).
- `index.ts` — Convenience re-export of the types.

## Adding a new template

Templates ship inside a plugin (`apps/local/plugins/<id>/template/index.ts`). Steps:

1. Create the plugin directory and `manifest.json` (with `contributes.templates[]`).
2. Implement `template/index.ts` exporting a `Template` object — must satisfy `types.ts`.
3. Register the plugin in `../plugins-host/registry.ts`.
4. Template `files()` must return valid codoc content that passes `parseCodoc`. Test with `codoc init <name> --from <id> && codoc compile <name>`.
5. `$ref` values must use the `<path>#data.<fieldName>` format — referencing the entire `data` block is invalid.

## Constraints

- Templates are pure data — no IO, no filesystem, no network.
- Files are written idempotently (skip existing) by `commands/init.ts`.
- Components are installed via `addComponent` (also idempotent).
