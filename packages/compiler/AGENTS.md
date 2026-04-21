# @cobook/compiler

Parent: `packages/`
Reads from: `@cobook/core` (CodocAST, ResolveResult types)
Must never import from: `@cobook/storage`, `@cobook/service`, `@cobook/chat`, `@cobook/graph`

## Purpose

Pure transformation: `CodocAST + resolvedData → standalone MDX string`.

The output is a self-contained `.mdx` file where all `$ref` values are
inlined and data fields are exported as a JS object. Any MDX renderer
(VSCode preview, Vite, etc.) can render it without the codoc runtime.

## Contracts

- Zero side effects — pure function, no I/O
- Input is already-resolved data (resolution happens upstream)
- Output is valid MDX (ESM exports + JSX body)
- Error fields in `resolvedData` become omitted keys (not thrown)
