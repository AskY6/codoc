# @cobook/parser

Boundary parser + source provider infrastructure for codoc files. Shared by both product lines (local CLI and server/web).

Parent: [`../../CLAUDE.md`](../../CLAUDE.md)
Reads from: `@cobook/core` (AST types, `parseRef`, branded constructors).
Must never import from: `@cobook/service`, `@cobook/storage`, `@cobook/graph`, `@cobook/chat`.

## Modules

| File | What it owns |
|---|---|
| `parse-codoc.ts` | `parseCodoc(content) → Result<CodocAST, ParseError>` — splits frontmatter, parses YAML, classifies data fields, returns typed AST. |
| `source.ts` | `SourceProvider` interface + `SourceRegistry` type — outbound port for `$source` field evaluation. |
| `registry.ts` | `createSourceRegistry()` — factory that builds the default registry with the generic built-in providers only. |
| `http-json.ts` | `httpJsonProvider` — fetches a URL via HTTP GET, returns parsed JSON. Supports optional `path` param for nested value extraction. |
| `index.ts` | Barrel re-export. |

## Scope: generic providers only

This package is the codoc format + provider port. It must stay **domain-agnostic** — no scheme tied to a vertical product (RSS, Gmail, Notion, ...) lives here. Such schemes belong in their owning plugin and are mixed into the runtime registry by the host. The only built-in provider is `httpJsonProvider`, which has no domain assumptions.

## Frontmatter format

```yaml
---
title: "..."
description: "..."
tags: [a, b]
schema:
  fieldName: type
data:
  static_field: value
  ref_field:
    $ref: "./other.codoc#data.fieldName"
  source_field:
    $source: providerName
    param: value
---
MDX body here
```

## Data field classification

| YAML shape | DataField variant |
|---|---|
| `{ $ref: "path#data.field" }` | `{ kind: "ref", ref: Ref }` |
| `{ $source: "name", ...params }` | `{ kind: "source", source, params }` |
| anything else | `{ kind: "static", value }` |

## Adding a new provider

**Generic provider** (no domain assumptions):
1. Create `<name>.ts` exporting a `SourceProvider`.
2. Add it to `createSourceRegistry()` in `registry.ts`.
3. Automatically available in every workspace via `$source: "<name>"`.

**Vertical / scheme provider** (e.g. `rss`, `gmail`): do **not** add it here. Ship it inside the owning plugin's `server/source-provider.ts`; the host mixes it into the registry at boot. See `apps/local/src/plugins/source-registry.ts` for the current wiring (Phase 2 will replace this with manifest-driven discovery).
