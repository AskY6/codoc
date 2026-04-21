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
| `registry.ts` | `createSourceRegistry()` — factory that builds the default registry with all built-in providers. |
| `http-json.ts` | `httpJsonProvider` — fetches a URL via HTTP GET, returns parsed JSON. Supports optional `path` param for nested value extraction. |
| `index.ts` | Barrel re-export. |

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

1. Create `<name>.ts` exporting a `SourceProvider`.
2. Add it to `createSourceRegistry()` in `registry.ts`.
3. The provider is automatically available in codocs via `$source: "<name>"`.
