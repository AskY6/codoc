# service / usecases / codoc

Use cases that act on the codoc aggregate.

Parent: [`../AGENTS.md`](../AGENTS.md) — full use case rules.
See also: [`../workspace/AGENTS.md`](../workspace/AGENTS.md) — the
reference implementation whose envelope / rev / conflict conventions
this aggregate copies verbatim.

## Slice 2 contents

| File | Purpose |
|---|---|
| `list-codocs-by-workspace.ts` | Return every codoc in a workspace as a `CodocListItem`. Fails with `workspace-not-found` when the owning workspace is missing, so the UI never silently renders an empty list for a typo'd id. |
| `create-codoc.ts` | Mint a codoc under a workspace from `{ workspaceId, path, title }`. Use case owns the `CodocId`; transports never supply one. |
| `delete-codoc.ts` | Delete a codoc by id. |

`get-codoc` / `update-codoc` land in slice 3 when the detail page
introduces a proper parsed `CodocDetail` DTO.

## Locked-in conventions

### DTO is flattened, not nested

`CodocListItem` is a flat `{ id, path, title, updatedAt, rev }` —
unlike `WorkspaceListItem` it does NOT nest the canonical core
`Codoc` type. The deviation is deliberate and documented in
`../../types/codoc.ts`: `Codoc.ast` holds `ReadonlyMap`s that
JSON-serialise to `{}`, so a nested DTO would silently lose its
`data` / `schema` fields over the wire. Slice 3 adds a proper
wire-safe `CodocDetail` shape when the detail page needs the ast.

Every other field convention — `updatedAt` as a peeled `Timestamp`
number, `rev` as a peeled opaque `string`, storage brands staying
inside `repo/` — matches the workspace aggregate. Read
`../workspace/AGENTS.md` for the rationale; this file does not
restate it.

### Empty-AST codocs on create

`createCodoc` takes `{ workspaceId, path, title }` and builds a
minimal `Codoc` with:

- `content: ""`
- `ast.meta`: the supplied `title`, `description: null`, `tags: []`,
  `schema: new Map()`
- `ast.data`: `new Map()`
- `ast.view: { kind: "empty" }`

This keeps the parser out of the service layer. Codocs start life
as "title-only" entries and pick up real content when the slice 3
editor lands. Until then there is no MDX → AST step inside a
create use case — the day that changes, the parser will live in a
dedicated service helper, not in `createCodoc` itself.

### Workspace existence check on read

`listCodocsByWorkspace` pre-checks the workspace before fanning out
to `codocRepo.listByWorkspace`. Two reasons:

1. The UI gets a clean `workspace-not-found` error instead of a
   silent empty list for a typo'd id.
2. When auth lands in a later slice, the first line of every
   "scoped-to-workspace" use case is already a workspace lookup,
   which is the natural place to plug in a capability check.

### `CodocReferenced` is structurally unreachable in slice 2

`ThreadCodocStore` stays stubbed, so nothing ever refers to a codoc
and `delete-codoc` can never actually return `codoc-referenced`.
The variant is still listed in the error union so the HTTP mapping,
wire shape, and ADT exhaustiveness check are frozen now. The slice
that ships the real thread-codoc store only needs to wire the
storage-side referrer check — no use case signatures change.
