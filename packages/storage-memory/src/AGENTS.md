# @cobook/storage-memory

In-process implementation of the `Storage` port from `@cobook/storage`.

Parent: [`../../../packages/storage/src/AGENTS.md`](../../storage/src/AGENTS.md) — owns the contract this package implements.
Reads from: `@cobook/core`, `@cobook/storage`.
Must never import from: `@cobook/service`, `@cobook/graph`, `@cobook/chat`, anything in `apps/`.

## Purpose

Two consumers, one impl:
- **use case tests** in `@cobook/service` — tests run against a real `Storage`, never against mocks.
- **dev server** — `apps/server` boots with this until a DB-backed adapter exists.

## What's implemented in slice 1

- `WorkspaceStore` — full `get / list / create / update / delete` against a `Map<WorkspaceId, StoredWorkspace>`. Stamps `createdAt` / `updatedAt` via the injected `Clock`. `update` enforces the `expectedRev` optimistic-concurrency contract.
- `SystemClock` — returns `Date.now()` cast to `Timestamp`. Tests that need deterministic time pass their own `Clock` to `createMemoryStorage`.
- `withTransaction(fn)` — calls `fn` with a fresh `Ctx`. **No real atomicity**: every store call mutates the backing Map in place. The shape still matches the port so use case code stays portable when a real storage adapter lands.

## Stub-store convention

The other 7 stores (`codocs`, `agents`, `threads`, `threadCodocs`, `threadAgents`, `workspaceAgents`, `sessions`) are Proxies built by `notImplementedStore`. **Every method on them throws `NotImplementedError`** — a real exception, not `Result.err`. The reasoning:
- These are programming errors. A use case calling an unimplemented store has wired up the wrong slice.
- `Result` is reserved for expected business failures. Mixing the two would let bugs slip through pattern-matches.

Each future vertical slice replaces one stub with a real store as it needs it.

## Cascading deletes

The `Storage` port states that deleting a workspace cascades across every dependent store. In slice 1 there is nothing to cascade — the dependent stores are stubs and hold no rows — so the cascade is a documented no-op. The first slice that ships a real `CodocStore` (or any other workspace-owned store) is responsible for wiring its rows into the cascade in `stores/workspace.ts::delete`.

## Adding a new store

1. Implement it under `src/stores/<name>.ts` exporting a `createMemory<Name>Store(deps): <Name>Store` factory.
2. Wire it into `createMemoryStorage` in `src/storage.ts`, replacing the corresponding entry in `stubs.ts`.
3. Remove the stub export from `src/stores/stubs.ts`.
4. If the store is owned by a workspace, extend the `WorkspaceStore.delete` cascade to wipe its rows.
