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

### Parser integration on create and update

`createCodoc` accepts an optional `content` field. When present,
the content is parsed via `parseCodoc` (from `../../parser/`) into
a full AST with meta, data fields, and MDX view. When omitted, an
empty AST is built from the `title` alone (backward-compatible with
title-only entries).

`updateCodocContent` always re-parses the AST from the new content.
The AST is the derived form; content is the source of truth.

Parse failures surface as `codoc-parse-failure` (→ 400 at the
transport layer).

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

### Content updates re-parse the ast

`updateCodocContent` reads the current `Codoc`, re-parses the new
`content` via `parseCodoc`, and writes the result with the fresh
AST. The ast is always derived from content — there is no
independent ast mutation path.

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

The parser now populates `ast.data`, so codocs can have real data
fields and refs. The next step is to:
- add the dag rebuild call inside `updateCodocContent` (after the
  parse, before the write)
- decide where the DAG lives across requests (rebuilt per save?
  cached on the workspace repo?)
- extend `CodocDetail` (or a sibling DTO) with a wire-safe
  `nodeState` projection

This is deferred to a dedicated DAG-integration slice.
