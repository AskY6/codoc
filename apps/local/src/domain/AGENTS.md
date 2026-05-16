# domain/

Parent: `apps/local/src/`
Reads from: `@cobook/core`, `@cobook/parser` (types only), `@mdx-js/mdx`, `yaml`, `../sources/state.js` (types only)
Must never import from: `node:*`, `chokidar`, `esbuild`, `../runtime/`, `../server/`, `../commands/`, `../plugins/`, `../providers/`, `../templates/`

## Purpose

Pure domain layer: in-memory Workspace shape and the analysis utilities that
operate on it. No file IO, no native modules, no event emitters, no schedulers —
everything here is referentially transparent given its inputs.

The runtime layer (`../runtime/`) imports from here. The reverse is forbidden.

## Key files

- `types.ts` — `LocalCodoc`, `Workspace`, `WriteResult`, `buildAstMap`. The
  Workspace type carries a mutable `customComponents` slot that the runtime
  scanner fills; the type itself stays pure.
- `components.ts` — `CustomComponent` / `CustomComponentError` /
  `CustomComponentEntry` type declarations only. The scanner that produces
  these entries lives in `../runtime/components.ts`.
- `resolve.ts` — pure `$ref` / `$source` resolution over `Map<CodocPath, CodocAST>`.
- `diagnose.ts` (+ `diagnose.test.ts`) — MDX-level static analysis (unknown
  components, unknown data fields, syntax errors).
- `recognize.ts` — pure component-enhancement detection + `BUILTIN_COMPONENT_META`.
- `patch.ts` — YAML frontmatter field patcher.

## Constraints

- No `node:fs`, no `chokidar`, no `esbuild`, no HTTP / MCP / CLI imports.
- Functions are pure where the signature allows; otherwise they consume already-
  resolved values (state maps, registries) rather than reading state themselves.
- The runtime layer may import from here; this layer may not import from runtime.
