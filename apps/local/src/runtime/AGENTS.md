# runtime/

Parent: `apps/local/src/`
Reads from: `../domain/`, `@cobook/core`, `@cobook/parser`, `@cobook/compiler`, `../sources/state.js`, `node:*`, `chokidar`, `esbuild`
Must never import from: `../server/`, `../commands/`, `../plugins/`, `../providers/`, `../templates/`

## Purpose

Side-effectful workspace runtime: load `.codoc` files from disk, drive
resolution, compile `.mdx` output, watch for changes, scan custom components,
and own the mutation loop. Domain types and pure analysis live in `../domain/`.

## Key files

- `workspace.ts` — IO entry points (`loadWorkspace`, `loadFile`, `removeFile`,
  `resolveAll`, `compileAll`, `compileOne`, `writeCodoc`, `loadComponents`).
  Reads/writes the source dir, the out dir, and `.source-state.json`. The
  diagnostics + recognize calls inside `writeCodoc` come from `../domain/`.
- `service.ts` — mutation API (`updateDataField`, `updateSourceFieldCache`,
  `updateSourceFieldParam`, `updateArticleState`). Owns the "mutate → persist
  → recompile → notify" cycle. Shared by MCP tools, REST routes, and the
  source scheduler.
- `watcher.ts` — chokidar debounced rebuild on file changes.
- `components.ts` — `scanComponents` (esbuild-driven .tsx → CJS scan over
  `.codoc/components/`). The result types live in `../domain/components.ts`.

## Constraints

- Domain types come from `../domain/types.js`; do not redefine them here.
- HTTP / MCP / CLI must not be imported — this layer is server-agnostic.
- Mutations from outside this layer go through `service.ts`, not direct
  `writeCodoc` calls.
