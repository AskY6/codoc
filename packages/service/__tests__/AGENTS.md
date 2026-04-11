# service / __tests__

Vitest suite for the service layer. Mirrors the `src/` tree —
`__tests__/usecases/<aggregate>/<use-case>.test.ts` for each use case.

Parent: [`../src/usecases/AGENTS.md`](../src/usecases/AGENTS.md) — owns
the "no mocks, real storage" rule that this directory enforces.

## Layout

```
__tests__/
  helpers/
    ctx.ts            makeTestCtx + counterIdGenerator
  usecases/
    workspace/
      list-workspaces.test.ts
      create-workspace.test.ts
      delete-workspace.test.ts
    <aggregate>/
      ...
```

One test file per use case file. The test file mirrors the use case
file's path under `__tests__/usecases/`, not under `__tests__/src/` —
the `src/` segment is implicit.

## `makeTestCtx`

Every test starts with:

```ts
const { ctx } = makeTestCtx();
```

`makeTestCtx`:
- builds a fresh `createMemoryStorage()` (no shared state across tests)
- wires a fresh `counterIdGenerator()` so ids are deterministic (`ws_1`, `ws_2`, …)
- uses the real `SystemClock` — tests that need deterministic time inject their own `Clock` later by extending the helper, but slice 1 hasn't needed one yet

The bundle returned today is just `{ ctx }`. Future slices that need
direct access to the underlying `storage` (e.g. to seed rows that no
use case can create yet) should extend `TestCtxBundle` rather than
calling `createMemoryStorage` themselves — keeps the wiring centralised.

## Deterministic ids

The default `counterIdGenerator` returns sequential branded ids per
aggregate. New aggregates extend it the same way the production
`IdGenerator` port grows: add a method, increment a counter.

When a test needs to **force** a particular id (e.g. to provoke
`*-already-exists`), spread `ctx` with a one-off `idGen`:

```ts
const fixedCtx = { ...ctx, idGen: { workspaceId: () => "ws_fixed" as never } };
```

## Assertions

Tests assert through repo methods (`workspaceRepo.get`, …) or by
calling other use cases. **Never** reach into `storage.workspaces`
directly — that bypasses the `StoredX` envelope peeling and couples
the test to the storage adapter.

## What NOT to put here

- Tests that need a real database. Those land alongside the
  DB-backed adapter (e.g. future `@cobook/storage-pg/__tests__/`).
- Tests that exercise transports (HTTP routes, CLI). Those live in
  `apps/server/__tests__/` and `apps/cli/__tests__/`.
- Mocks of `Storage`. The whole reason `@cobook/storage-memory`
  exists is so we never need them.
