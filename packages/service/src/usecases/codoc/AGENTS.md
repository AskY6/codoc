# service / usecases / codoc

Use cases that act on the codoc aggregate.

Parent: [`../AGENTS.md`](../AGENTS.md) — full use case rules.
See also: [`../workspace/AGENTS.md`](../workspace/AGENTS.md) — the
reference implementation whose envelope / rev / conflict conventions
this aggregate copies verbatim.

## Contents

| File | Purpose |
|---|---|
| `list-codocs-by-workspace.ts` | Return every codoc in a workspace as a `CodocListItem`. Fails with `workspace-not-found` when the owning workspace is missing, so the UI never silently renders an empty list for a typo'd id. |
| `create-codoc.ts` | Mint a codoc under a workspace from `{ workspaceId, path, title }`. Use case owns the `CodocId`; transports never supply one. |
| `get-codoc.ts` | Return a single codoc as a `CodocDetail` DTO. Powers the detail page. |
| `update-codoc-content.ts` | Overwrite a codoc's raw `content` with optimistic concurrency (`{ id, content, expectedRev }`). Returns the refreshed `CodocDetail`. |
| `delete-codoc.ts` | Delete a codoc by id. |

## Locked-in conventions

### DTOs are flattened, not nested

Both `CodocListItem` and `CodocDetail` are flat — unlike
`WorkspaceListItem`, neither nests the canonical core `Codoc` type.
The deviation is deliberate and documented in `../../types/codoc.ts`:
`Codoc.ast` holds `ReadonlyMap`s that JSON-serialise to `{}`, so a
nested DTO would silently lose its `data` / `schema` fields over the
wire. `CodocDetail` adds `content: string` on top of the list row for
the editor to bind to; the ast stays server-side until a slice
introduces a wire-safe projection for structured data (see
"Deferred: nodeState and the dag" below).

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

### Content-only updates preserve the ast

`updateCodocContent` reads the current `Codoc` via
`codocRepo.getCodoc`, spreads the new `content` onto it, and writes
the result back. Crucially it does **not** touch `ast.meta`,
`ast.data`, or `ast.view`. The rationale:

- The editor binds to `content` (raw source), not to a parsed ast.
- There is no MDX / YAML parser inside the service layer yet; core's
  `codoc/AGENTS.md` explicitly forbids parsing at this layer.
- Re-deriving the ast from `content` at update time would require a
  parser running in the service — deferred until a later slice
  introduces one as a dedicated helper.

When the parser lands, `updateCodocContent` (or a replacement) will
re-parse the ast inside the same use case before the write. No
caller or wire shape has to change.

### `Conflict<"codoc">` recovery keeps the editor buffer

Slice 1.5 established "refetch + require re-save" for small
field-level edits. For codoc content the user is typing into a
textarea, and throwing that buffer away on 409 is a bad trade.
Slice 3 extends the rule:

- On `codoc-conflict`, the UI invalidates the detail query so the
  react-query cache holds the fresh `rev`. The **editor buffer is
  left intact**.
- The page surfaces an inline amber warning with two options:
  1. **Save again** — reads the fresh rev from the cache and writes
     the user's draft, deliberately overwriting the concurrent edit.
  2. **Reload from server** — an explicit opt-in that copies the
     server copy back into the editor buffer (discarding the draft).
- Silent replay is still avoided. The first save after a conflict
  still succeeds against the fresh rev, but only because the user
  has seen the warning and made a choice.

This is the pattern every future long-form-document use case should
copy. Field-level edits (workspace rename, codoc rename) keep the
slice-1.5 "force refetch, require re-confirm" shape.

### Deferred: nodeState and the dag

The original slice-3 plan called for exercising `@cobook/core/dag`
from the use case and exposing `nodeState` on the DTO. Slice 3 as
shipped does **neither**, and the reason is mechanical: until a
parser populates `ast.data`, every codoc has zero data fields, every
build produces an empty DAG, and every `nodeState` projection is
uniformly empty. Wiring a no-op through the stack would be dead
code that exercises nothing.

The slice that introduces the parser is the natural place to:
- add the dag rebuild call inside `updateCodocContent`
- decide where the DAG lives across requests (rebuilt per save?
  cached on the workspace repo?)
- extend `CodocDetail` (or a sibling DTO) with a wire-safe
  `nodeState` projection

This deferral is recorded here rather than in `docs/slices.md` so
the next slice's planning session has it on hand without having to
re-discover it.
