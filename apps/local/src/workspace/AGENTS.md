# workspace/

Parent: `apps/local/src/`
Reads from: `../sources/state.js` (resolved data cache + lastFetchedAt)
Must never import from: `../server/`, `../commands/`, `../plugins/`, `../providers/`, `../templates/`

## Purpose

In-memory codoc workspace state plus the pure analysis utilities that operate on it.
Reads `.codoc` files from disk, parses to AST, resolves `$ref` / `$source`, compiles to
`.mdx`, and exposes that state to servers + commands as the single source of truth.

## Key files

- `index.ts` — workspace loader (`loadWorkspace`, `loadFile`, `removeFile`, `compileAll`,
  `compileOne`, `writeCodoc`, `resolveAll`, `loadComponents`, `buildAstMap`); the public
  entry point everything else imports as `from "./workspace/index.js"`.
- `service.ts` — mutation API (`updateDataField`, `updateSourceFieldCache`,
  `updateSourceFieldParam`, `updateArticleState`). Shared by MCP tools, REST routes,
  and source scheduler. Owns the "mutate → persist → recompile → notify" cycle.
- `resolve.ts` — pure `$ref` / `$source` resolution over `Map<CodocPath, CodocAST>`.
- `diagnose.ts` (+ `diagnose.test.ts`) — MDX-level static analysis (unknown components,
  unknown data fields, syntax errors).
- `recognize.ts` — pure component-enhancement detection + `BUILTIN_COMPONENT_META`.
- `components.ts` — scans `.codoc/components/*.tsx`, transpiles to CJS via esbuild.
- `patch.ts` — YAML frontmatter field patcher (only `service.ts` uses it).
- `watcher.ts` — chokidar debounced rebuild on file changes.

## Constraints

- No HTTP / MCP / CLI imports — this subtree is server-agnostic.
- `resolve.ts`, `diagnose.ts`, `recognize.ts`, `patch.ts` stay pure (no IO).
- Mutations go through `service.ts`, not direct calls to `writeCodoc` from outside.
