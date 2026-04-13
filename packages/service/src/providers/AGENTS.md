# providers/

Built-in source provider implementations for codoc `$source` fields.

Parent: [`../../AGENTS.md`](../../AGENTS.md)
Reads from: [`../ports/source.ts`](../ports/source.ts) — `SourceProvider` interface.
Must never import from: `@cobook/core` (providers are service-layer concerns), `../usecases/`, `../repo/`.

## Contents

| File | Purpose |
|---|---|
| `index.ts` | `createSourceRegistry()` — factory that builds the default `SourceRegistry` with all built-in providers. |
| `http-json.ts` | `httpJsonProvider` — fetches a URL via HTTP GET, returns parsed JSON. Supports optional `path` param for nested value extraction. |

## Adding a new provider

1. Create `<name>.ts` exporting a `SourceProvider`.
2. Add it to `createSourceRegistry()` in `index.ts`.
3. The provider is automatically available in codocs via `$source: "<name>"`.

## Provider contract

- `execute(params)` receives the opaque params from the codoc's YAML frontmatter.
- Throw on failure — the evaluation engine catches and converts to `ResolveResult.error`.
- Validate params eagerly — throw with a clear message if required params are missing.
- Providers must be stateless; no caching (that belongs to a future evaluation cache layer).
