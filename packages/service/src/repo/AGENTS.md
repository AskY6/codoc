# service / repo

Thin facade layer over `@cobook/storage`. One module per storage store.

Parent: [`../../AGENTS.md`](../AGENTS.md) — full layering rules and
what belongs in use cases vs. here.

## What a repo module does

1. **Forwards to exactly one storage store.** Pass-through, nothing else.
2. **Peels `StoredX` envelopes.** Use cases see pure core types
   (`Workspace`, `Codoc`, …); `Rev` / `Timestamp` stay internal.
3. **Maps storage error variants → service error variants.** Use cases
   pattern-match on `ServiceError`, never on storage errors.
4. **May expose pure-read joins** — compositions across two stores that
   are logically one query and do not write or emit events.

## What a repo module must not do

- Open transactions (`withTransaction` belongs in use cases).
- Emit events.
- Import `@cobook/chat` or `@cobook/graph`.
- Authorize requests.
- Cache or memoize.
- Retry on conflict.

## Method shape

Every method:

- Takes `ServiceCtx` as its first argument and uses `ctx.storageCtx` to
  forward into the storage port. Never calls `ctx.storage.ctx()` — that
  would break transaction enrolment when the use case is already inside
  `withTransaction`.
- Returns `Promise<Result<T, ServiceError>>`.
- Returns pure core types, not `StoredX` envelopes.

```ts
async function get(
  ctx: ServiceCtx,
  id: WorkspaceId,
): Promise<Result<Workspace, WorkspaceNotFound>> {
  const r = await ctx.storage.workspaces.get(ctx.storageCtx, id);
  if (!r.ok) return err({ kind: "workspace-not-found", id });
  return ok(r.value.workspace);
}
```

## Error mapping quick reference

| Storage variant | Service variant |
|---|---|
| `NotFound<"workspace">` | `WorkspaceNotFound` |
| `AlreadyExists<"workspace">` | `WorkspaceAlreadyExists` |
| `Conflict<"workspace">` | `WorkspaceConflict` |
| `CodocReferenced` | `CodocReferenced` (re-export with same shape) |
| `ThreadCodocWorkspaceMismatch` | `ThreadCodocWorkspaceMismatch` (same shape) |
| `TxAborted` | `StorageUnavailable` (only ever seen by use cases, not repo) |

Repo modules only see per-method storage errors. `TxAborted` comes back
from `storage.withTransaction`, which only use cases call — repo never
sees it.
