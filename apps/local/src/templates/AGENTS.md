# templates/

Parent: `apps/local/AGENTS.md`
Reads from: `catalog.ts` (component names), `add.ts` (component installer)
Must never import from: `workspace.ts`, `http-server.ts`, `mcp-server.ts`

## Purpose

Built-in workspace templates. Each template is a TS module that
returns a list of `.codoc` files and component names. Templates are
applied during `codoc init --from <id>`.

## Module conventions

- One file per template (`rss.ts`, `bookmarks.ts`).
- Each exports a `Template` (see `types.ts`).
- `index.ts` is the registry — add new templates there.
- `yaml.ts` is the shared YAML serializer — no runtime dependency.

## Adding a new template

1. Create `<id>.ts` exporting `const <id>Template: Template`.
2. Add it to the `templates` array in `index.ts`.
3. Template `files()` must return valid codoc content that passes
   `parseCodoc`. Test with `codoc init <name> --from <id> && codoc compile <name>`.
4. `$ref` values must use the `<path>#data.<fieldName>` format —
   referencing the entire `data` block is invalid.

## Constraints

- Templates are pure data — no IO, no filesystem, no network.
- Files are written idempotently (skip existing).
- Components are installed via `addComponent` (also idempotent).
