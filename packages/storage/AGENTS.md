# @cobook/storage

The **storage port layer**. Interfaces only — zero runtime code, zero persistence implementation. Concrete backends (in-memory, SQLite, Postgres, …) live in separate packages and implement `Storage` from here.

Sibling: [`../core/AGENTS.md`](../core/AGENTS.md) — owns the pure domain types this package wraps. The tenancy / no-row-metadata / branded-id / Result-ADT invariants declared there apply here too.

## Where this package sits

```
@cobook/core        pure domain types + logic (no IO)
     ↑
@cobook/storage     port layer — this package
     ↑
<impl packages>     in-memory / SQLite / Postgres implementations
     ↑
@cobook/service     use cases; depends only on the port
```

Service code imports `@cobook/storage` and nothing deeper. It must never reach past the port into an implementation package.

## File layout

| Path | Responsibility |
|---|---|
| `src/ctx.ts` | `Ctx` — opaque transaction handle threaded through every store method |
| `src/clock.ts` | `Clock` port — injected time source so implementations can be tested with fake time |
| `src/meta.ts` | `Rev`, `Timestamp` — branded storage-only metadata types |
| `src/errors.ts` | Every error ADT: `NotFound`, `AlreadyExists`, `Conflict`, `CodocReferenced`, `ThreadCodocWorkspaceMismatch`, `TxAborted` |
| `src/stored.ts` | `StoredX` envelopes that wrap core values with `rev` / timestamps / ownership |
| `src/stores/*.ts` | One file per store interface |
| `src/storage.ts` | `Storage` facade aggregating every store + `ctx()` + `withTransaction` |
| `src/index.ts` | Public barrel — type-only re-exports |

## What the port actually models

### 1. `StoredX` envelopes, not augmented core types

Core's `Codoc`, `Workspace`, `ChatMessage`, etc. stay pure. Storage metadata lives on a separate envelope:

```ts
interface StoredCodoc {
  readonly codoc: Codoc;              // pure, straight from core
  readonly workspaceId: WorkspaceId;  // tenancy — storage-only
  readonly rev: Rev;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}
```

`workspaceId` is the canonical example: `core/codoc` is forbidden from referring to cobook concepts, so ownership must live on the envelope, never on the core type. The same rule applies to any future storage-only field — do not push it into core "because it's convenient".

### 2. There is no `DagStore`

`buildDAG(codocs)` is a pure function in `core/dag`. The DAG is **derived** from the current set of codocs; it is not persisted. Anywhere you are tempted to add a DAG store, add a memoising projection in the service layer instead.

### 3. Ctx + `withTransaction` — behaviour-based transactions

Transactions are **opt-in per use case**, not per method:

```ts
// single-step action — auto-commit
codocStore.create(storage.ctx(), input);

// composite action — one atomic transaction
storage.withTransaction(async (ctx) => {
  const created = await codocStore.create(ctx, input);
  if (!created.ok) return created;
  return threadCodocStore.link(ctx, { threadId, codocId: created.value.codoc.id });
});
```

Rules:
- **Every store method takes `Ctx` as its first argument.** No exceptions. This lets single-step calls share the same signature as calls from inside a transaction.
- **Only compose multiple store calls inside `withTransaction`.** If a service method only touches one store, call it directly on `storage.ctx()`.
- **`Ctx` is opaque.** Service code never inspects it. Implementations extend the interface with their own transaction handle and keep that state private.

### 4. Optimistic concurrency via `expectedRev`

Every mutable entity store's `update` takes `{ value, expectedRev }`. On mismatch the store returns `Conflict<"entity">` with `currentRev`; on success it returns a new `StoredX` with a fresh `rev`.

- **There is no built-in retry.** Services return the conflict to the caller verbatim. Merge strategy is a UI concern, not a storage concern.
- **`Rev` is opaque to services.** They only compare Revs they previously received.
- **Join tables do not carry `rev`.** They are set-semantics — insert or delete, no update — so `expectedRev` would be meaningless.

### 5. Hard delete + refuse if referenced

`CodocStore.delete` fails with `CodocReferenced` if any `ThreadCodoc` row still points at the codoc. The error carries the referring `ThreadId`s so the caller can render a meaningful "unlink from these threads first" dialog.

Soft delete is **not** modeled here. If a tombstone lifecycle is ever needed it belongs one layer up, not in the port.

### 6. Cross-workspace references are disallowed (for now)

A `ThreadCodoc` link must connect a thread and a codoc that live in the same workspace. This invariant is enforced **inside `ThreadCodocStore.link`**, not in service code, so callers cannot forget to check. The error is `ThreadCodocWorkspaceMismatch`.

Consequences:
- `CodocStore.delete`'s reference check only needs to look at joins within the owning workspace.
- `WorkspaceStore.delete` can cascade over its own rows without worrying about dangling external references (see next rule).

### 7. `WorkspaceStore.delete` is a cascade

Deleting a workspace atomically removes every dependent row owned by it — codocs, threads, chat messages, thread↔codoc links, thread↔agent links, workspace↔agent links, and agent sessions. Services call `workspaces.delete` once; they do not enumerate dependents themselves.

Because cross-workspace codoc references are disallowed, the cascade never has to touch rows outside the workspace.

### 8. `AgentSession` uses explicit `create` + `update`, not `upsert`

Upsert collapses two distinct intents ("I am inserting a fresh session" vs "I am updating an existing one with this `expectedRev`") into one method. The port keeps them separate so the concurrency contract for each path is unambiguous.

### 9. Store-level invariants vs service-level checks

The rule: **invariants enforced by the port live inside the store method**. Things that are *business policy* (which user can do what, whether to require confirmation, rate limits) live in the service layer.

Currently in-port:
- `ThreadCodoc` same-workspace constraint
- `CodocReferenced` on delete
- `expectedRev` conflict detection
- `seq` atomicity for `appendMessage`
- Cascading `WorkspaceStore.delete`

Currently out-of-port:
- Permission / auth
- Retry on conflict
- Multi-step business workflows

## Adding a new store

1. **Decide the aggregate root.** One file per root under `src/stores/`. A store owns the invariants on writes to its aggregate; no hidden cross-store writes inside a single store method (exception: the `ThreadCodoc` workspace check, which reads but does not write sibling stores).
2. **Add the `StoredX` envelope** to `src/stored.ts`. Envelopes are the only place where storage metadata meets core values.
3. **Add dedicated error variants** to `src/errors.ts` if the existing ones do not fit. Prefer the generic `NotFound<K>` / `Conflict<K>` / `AlreadyExists<K>` parameterised helpers over one-off copies. If the failure needs structured context (referrers, conflicting revs, etc.), write a bespoke variant.
4. **Thread `Ctx` through every method.** Even getters. This is not optional.
5. **Plug the store into the `Storage` facade** in `src/storage.ts` and export its types from `src/index.ts`.
6. **Return `Result`**, never throw. Unexpected IO failures are the implementation's business and bubble out of `withTransaction` as `TxAborted`.

## What does NOT go here

- **No implementation.** This package never imports `node:fs`, a SQL driver, or anything that touches the outside world. If you find yourself adding a dependency, you are in the wrong package.
- **No service-level use cases.** "Create a workspace and seed it with three codocs" is not a port method. It is a service method that opens a `withTransaction` and calls three store methods inside.
- **No retry logic.** Conflicts come back as `Conflict<...>` and the caller decides.
- **No soft delete, no tombstones, no undo stack.** Not modeled; if needed, layer on top.
- **No `DagStore`.** The DAG is derived from codocs.
- **No permissions / ACL.** The port trusts its caller. Authorisation is a service concern.
- **No timestamps or rev fields on core domain types.** They live on `StoredX` envelopes exclusively. If a core type seems to need a `createdAt`, the correct fix is to read it off the envelope at the call site.
- **No exceptions as control flow.** Every domain failure is an ADT variant returned via `Result`.
