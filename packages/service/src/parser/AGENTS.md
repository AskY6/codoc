# service / parser

Boundary parser that converts raw codoc content (YAML frontmatter + MDX body) into the canonical `CodocAST` from `@cobook/core`.

Parent: [`../AGENTS.md`](../../AGENTS.md) — service-layer rules.
Reads from: `@cobook/core` (AST types, `parseRef`).
Must never import from: `../repo/`, `../usecases/`, `@cobook/storage`.

## Modules

| File | What it owns |
|---|---|
| `parse-codoc.ts` | `parseCodoc(content) → Result<CodocAST, ParseError>` — splits frontmatter, parses YAML, classifies data fields, returns typed AST. |
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

Reserved top-level keys: `title`, `description`, `tags`, `schema`, `data`.

## Data field classification

| YAML shape | → DataField variant |
|---|---|
| `{ $ref: "path#data.field" }` | `{ kind: "ref", ref: Ref }` (parsed via `parseRef` from core) |
| `{ $source: "name", ...params }` | `{ kind: "source", source, params }` |
| anything else | `{ kind: "static", value }` |

## Error ADT

`ParseError` has three variants: `invalid-yaml`, `frontmatter-not-mapping`, `invalid-ref`. All errors are returned as `Result`, never thrown.

## Design decisions

- **Lives in service, not core.** Core's invariant is zero runtime deps and no raw text. The parser is a boundary concern that depends on the `yaml` npm package.
- **Returns `Result`, not exceptions.** Matches the core convention so use cases can pattern-match without try/catch.
- **Lenient on missing frontmatter.** Content without `---` delimiters is treated as a pure MDX body (no meta, no data). This supports the transition from title-only codocs.
