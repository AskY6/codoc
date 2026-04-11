# @cobook/core

Pure domain types and logic for the cobook platform. Zero runtime dependencies, zero IO, zero framework.

This is the **root node** of a tree-based context layout. Each subtree has its own `AGENTS.md` — read only the ones relevant to your task.

## Subtree index

| Path | Responsibility | Depends on |
|---|---|---|
| [`src/shared/AGENTS.md`](src/shared/AGENTS.md) | `Result<T,E>`, `Brand<T,B>` primitives | — |
| [`src/codoc/AGENTS.md`](src/codoc/AGENTS.md) | Structural definition of the knowledge unit | `shared` |
| [`src/dag/AGENTS.md`](src/dag/AGENTS.md) | Field-level dependency graph over codocs | `shared`, `codoc` |
| [`src/cobook/AGENTS.md`](src/cobook/AGENTS.md) | Workspace / agent / chat collaboration layer | `shared`, `codoc` (IDs only) |

## Cross-module invariants

These apply to **every** subtree. They are not repeated inside subtree docs.

### 1. Import direction is strictly inward

```
dag    → codoc
cobook → codoc   (only via CodocId — never reads codoc internals)
codoc  → (nothing)
shared → (nothing)
```

No sibling ever imports another sibling. `dag` never imports from `cobook` and vice versa. Violating this is an architectural break, not a style issue.

### 2. Tenancy lives only in `cobook`

`codoc/` and `dag/` must not mention `workspaceId` or any cobook concept. A codoc is defined independently of who owns it; cobook layers tenancy on top via `ThreadCodoc` / `WorkspaceAgent` join records.

### 3. No row metadata in core

`createdAt`, `updatedAt`, surrogate numeric ids, audit columns — these belong to the storage layer. Core entities only carry their intrinsic domain shape.

### 4. IDs are branded

All IDs are `Brand<string, "...">`. The compiler refuses to mix `CodocId` / `NodeId` / `WorkspaceId` even though the runtime is just a string. See [`src/shared/AGENTS.md`](src/shared/AGENTS.md).

### 5. Pure functions return `Result<T, E>`

Core never throws. Illegal states are eliminated via ADT (sum type + discriminant), not via runtime checks. If you are tempted to `throw`, change the return type instead. See [`src/shared/AGENTS.md`](src/shared/AGENTS.md).

### 6. Zero runtime dependencies

No `node:*`, no filesystem, no network, no framework. `src/codoc/ref.ts` hand-rolls its own posix path helpers for this reason.

## Public entry point

`src/index.ts` re-exports every public symbol from the four subtrees. Consumers should import from `@cobook/core`, not from a deep path.

## When adding a new domain concept

1. Decide which subtree owns it — use the dependency direction above.
2. Read that subtree's `AGENTS.md` for local conventions.
3. If the concept spans two subtrees, the correct place is the **more inward** one (e.g. `NodeId` lives in `codoc/`, not `dag/`, because "a node is a field inside a codoc" — `dag/` only consumes that identity).
4. If tenancy is involved, it belongs in `cobook/`, period.
