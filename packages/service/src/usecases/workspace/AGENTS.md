# service / usecases / workspace

Use cases that act on the workspace aggregate.

Parent: [`../AGENTS.md`](../AGENTS.md) — full use case rules.

## Contents

| File | Purpose |
|---|---|
| `list-workspaces.ts` | Return every workspace as a `WorkspaceListItem` DTO (includes `rev` + `codocCount`). |
| `get-workspace.ts` | Return a single workspace as a `WorkspaceListItem`. Same envelope as `list-workspaces`, so the detail page header hydrates straight from the list query cache. |
| `create-workspace.ts` | Mint a workspace from `{ name, description }`. The use case owns the id; transports never supply one. |
| `update-workspace.ts` | Rename / re-describe a workspace by `{ id, name, description, expectedRev }`. Returns the new `WorkspaceListItem` with refreshed `rev` and current `codocCount`. |
| `delete-workspace.ts` | Delete a workspace by id; cascade into codocs (and every future dependent store) is enforced by the storage layer. |

## Locked-in conventions

These apply to **every future aggregate** — codoc, thread, agent, … —
unless a later slice explicitly overrides them. The workspace
aggregate is the reference implementation.

### DTO envelope shape

The list / get / update use cases return a UI-shaped envelope
defined in `../../types/workspace.ts`:

```ts
interface WorkspaceListItem {
  readonly workspace: Workspace;    // canonical core type, nested
  readonly updatedAt: number;        // peeled Timestamp
  readonly rev: string;              // peeled Rev, opaque to callers
  readonly codocCount: number;       // pure-read join on codocs
}
```

- **Nested, not flattened.** `dto.workspace` stays addressable as the
  canonical core shape so transports can `JSON.stringify` without
  reshaping.
- **Storage brands stay in storage.** `repo/` is the one place that
  peels `Rev` → `string` and `Timestamp` → `number`. Service callers
  and above only see the raw JS types.

### codocCount on the envelope

`codocCount` is a server-computed pure-read join across the workspace
and codoc stores, folded in by `workspaceRepo.list` /
`workspaceRepo.getListItem` via `codocRepo.countByWorkspace`. It
lands on the envelope for three reasons:

1. **One request per list render.** The UI card wants a "N codocs"
   badge; a client-side fan-out (one query per workspace) multiplies
   the round-trips. The list page already pays for a single
   `GET /api/workspaces`, and folding the count in is free.
2. **Consistent envelope.** `list` and `update` both return
   `WorkspaceListItem`; giving the two endpoints different shapes
   would force UIs to special-case the update path.
3. **Repo-layer pure-read join is allowed.** `repo/AGENTS.md`
   explicitly permits compositions across two stores that are
   logically one query and do not write. This is that composition.

The in-memory impl walks `listByWorkspace` per row. A real DB
adapter will replace the N+1 with a single `GROUP BY` without
changing the repo surface. The decision to revisit this if the
count ever grows expensive stays in the repo layer, not in use
cases — use cases just consume whatever the repo hands back.

### Rev / optimistic concurrency

- `list` / `get` responses include `rev` on the envelope. The client
  echoes it back on the next `update` call.
- `update*` takes `{ id, ...patch, expectedRev }`. The use case does
  **not** mint the id — update addresses an existing row. Only
  `create*` uses `ctx.idGen`, which keeps the `IdGenerator` port
  create-only.
- The service error union for `update*` is `XNotFound | XConflict`.
  `XConflict` is raised when the stored row's rev no longer matches
  `expectedRev`.
- `WorkspaceConflict` currently carries no payload. When a slice needs
  the fresh rev (or the current stored row) to power a smarter
  recovery path, extend the variant — do not add a parallel error
  kind.

### Conflict recovery at the transport edge

- HTTP maps `workspace-conflict` to **409** via the existing
  `apps/server/src/http/error.ts`.
- UIs that catch a conflict invalidate the list query (which refetches
  the fresh `rev`) and surface an inline "someone else edited this,
  reloaded — please re-save" message. They do **not** silently replay
  the write. Silent replay hides real conflicts from the user and can
  overwrite legitimate concurrent edits.
- Slice 3 (codoc content edit) may reopen this decision for long-form
  documents where re-typing is unacceptable. Workspace-level edits are
  small enough that re-confirming is fine.

### Transactions

No `withTransaction` in slice 1 / 1.5 — every workspace use case is a
single-store call. The first composite use case (e.g. "create
workspace + seed default codoc") will introduce a transaction and
become the reference future slices copy.
