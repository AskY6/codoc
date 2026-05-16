# commands/

Parent: `apps/local/src/`
Reads from: `../templates/`, `../plugins/registry.js`, `../workspace/recognize.js`
Must never import from: `../server/`, `../sources/`, `../workspace/index.js`, `../workspace/service.js`

## Purpose

One-shot CLI subcommands invoked from `index.ts`. Each command is a pure
filesystem operation against `~/.codoc/<workspace>/` — no long-lived state,
no servers, no schedulers.

## Key files

- `init.ts` — `codoc init <name> [--from <template>]`. Scaffolds workspace dir,
  `codoc.config.json`, optionally applies a template (codoc files + components).
  Idempotent: skips existing files.
- `add.ts` — `codoc add <component|--all|--list> [workspace]`. Copies a built-in
  component into `<workspace>/components/`. Idempotent.
- `catalog.ts` — built-in component TSX sources for `add.ts` (shadcn-style: you
  own the source after adding). Only `add.ts` reads it.

## Constraints

- No imports from `workspace/index.js` or `workspace/service.js` — these
  commands don't manipulate a live workspace, they only scaffold files.
- Templates declare components by *name*; the catalog supplies the source.
- All file writes are idempotent.
