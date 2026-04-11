# @cobook/storage-memory

In-process implementation of the `Storage` port from `@cobook/storage`.

Parent: [`../../../packages/storage/src/AGENTS.md`](../../storage/src/AGENTS.md) — owns the contract this package implements.
Reads from: `@cobook/core`, `@cobook/storage`.
Must never import from: `@cobook/service`, `@cobook/graph`, `@cobook/chat`, anything in `apps/`.

## Purpose

Two consumers, one impl:
- **use case tests** in `@cobook/service` — tests run against a real `Storage`, never against mocks.
- **dev server** — `apps/server` boots with this until a DB-backed adapter exists.

## What's implemented

- `WorkspaceStore` — full `get / list / create / update / delete` against a `Map<WorkspaceId, StoredWorkspace>`. Stamps `createdAt` / `updatedAt` via the injected `Clock`. `update` enforces the `expectedRev` optimistic-concurrency contract. `delete` cascades into every dependent real store via callbacks supplied at construction time.
- `CodocStore` (slice 2) — full `get / listByWorkspace / create / update / delete` against a `Map<CodocId, StoredCodoc>`. `create` refuses with `workspace-not-found` when the owning workspace is missing (cross-store check via a callback supplied at construction time). `delete` is currently unconditional — `ThreadCodocStore` is still a stub so there are never any referrers; the slice that ships the real thread-codoc store wires referrer detection back in without changing the store's surface.
- `SystemClock` — returns `Date.now()` cast to `Timestamp`. Tests that need deterministic time pass their own `Clock` to `createMemoryStorage`.
- `withTransaction(fn)` — calls `fn` with a fresh `Ctx`. **No real atomicity**: every store call mutates the backing Map in place. The shape still matches the port so use case code stays portable when a real storage adapter lands.

## Cross-store wiring

Two real stores today (`workspaces` and `codocs`) have to read each other's state: the codoc store validates that the target workspace exists on `create`, and the workspace store cascades into codocs on `delete`. Both are expressed as plain callbacks on the store's deps, wired in `src/storage.ts` via a two-phase construction — each store holds a reference that is populated after both have been created. No global state, no circular imports, no surprises about declaration order.

The pattern generalises: every future real store that participates in the workspace cascade adds a `cascade<StoreName>` hook to `MemoryWorkspaceStoreDeps`; the stubs contribute nothing.

## Stub-store convention

The remaining stores (`agents`, `threads`, `threadCodocs`, `threadAgents`, `workspaceAgents`, `sessions`) are Proxies built by `notImplementedStore`. **Every method on them throws `NotImplementedError`** — a real exception, not `Result.err`. The reasoning:
- These are programming errors. A use case calling an unimplemented store has wired up the wrong slice.
- `Result` is reserved for expected business failures. Mixing the two would let bugs slip through pattern-matches.

Each future vertical slice replaces one stub with a real store as it needs it.

## Cascading deletes

The `Storage` port states that deleting a workspace cascades across every dependent store. Today the cascade wipes `codocs` (slice 2); the other dependents are stubs and hold no rows. Each slice that replaces a stub with a real store must add its cascade hook to `MemoryWorkspaceStoreDeps` and wire it in `storage.ts`.

## Adding a new store

1. Implement it under `src/stores/<name>.ts` exporting a `createMemory<Name>Store(deps): <Name>Store` factory.
2. Wire it into `createMemoryStorage` in `src/storage.ts`, replacing the corresponding entry in `stubs.ts`.
3. Remove the stub export from `src/stores/stubs.ts`.
4. If the store is owned by a workspace, extend the `WorkspaceStore.delete` cascade to wipe its rows.
