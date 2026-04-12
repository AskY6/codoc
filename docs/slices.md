# Vertical slice roadmap

This is the working roadmap for the codoc rewrite. We build one
**page-end-to-end** slice at a time — every slice walks the full stack
(core → storage → storage-memory → service → server → web) for one
user-facing surface, validates every cross-layer convention against a
real consumer, and sets the patterns the next slice copies.

The vertical-slicing methodology is recorded in
[`memory/project_vertical_slicing.md`](../.claude/projects/-Users-kxzhang-code-local-tool-codoc/memory/project_vertical_slicing.md).
The locked-in conventions from slice 1 (DTO shape, error envelope,
react-query as the data layer, hand-rolled UI primitives, no CORS, …)
are documented in the matching `AGENTS.md` files.

Storage stores are implemented **on demand** by each slice — every
new aggregate replaces a `notImplementedStore` proxy in
`@cobook/storage-memory` the first slice that touches it. The
DB-backed adapter (`@cobook/storage-pg`) lands once enough slices have
validated the in-memory shape.

---

## Slice 1 — workspace list — DONE

**Page:** `/` workspace list
**Stores replaced:** `WorkspaceStore`
**Conventions set:**
- nested DTO envelope (`{ workspace, updatedAt }`)
- `IdGenerator` port; create use cases own the id
- HTTP error envelope `{ error: { kind, ... } }` + `mapServiceError`
- Vite `/api → :3100` proxy (no CORS)
- react-query is the UI data layer
- hand-rolled `Button` / `Card` / `Dialog` / `Input` primitives

**Use cases:** `listWorkspaces`, `createWorkspace`, `deleteWorkspace`.
**Routes:** `GET / POST / DELETE /api/workspaces`.

Verified via `/verify-fix` browser run.

---

## Slice 1.5 — workspace edit (PATCH) — DONE

**Why this existed:** the optimistic-concurrency path (`Rev` /
`expectedRev` / `Conflict`) is the most subtle thing in the storage
contract. Debugging it on a field-level edit (workspace name +
description) is much cheaper than on a 2 000-line codoc document.
This slice's only job was to put `Rev` end-to-end on the table —
every later update flow copies it.

**Page:** in-place name + description edit on the slice-1 list cards
(no new page). Pencil button on each card opens a reusable dialog
pre-filled with the card's current values; Save issues a PATCH with
the card's `rev` as `expectedRev`.

**Use cases:** `updateWorkspace`.
**Routes:** `PATCH /api/workspaces/:id`.

**Conventions locked in** (documented in
`packages/service/src/usecases/workspace/AGENTS.md` — this file is
the reference for slices 2 / 3 / 5):

- **`Rev` lives on `WorkspaceListItem`** as an opaque `rev: string`
  alongside the existing `{ workspace, updatedAt }`. The repo layer
  is the one place that peels the storage `Rev` brand to `string`;
  service callers and the wire treat it as write-once / read-equal.
- **HTTP conflict envelope** is `{ error: { kind: "workspace-conflict" } }`
  at status **409**, via the existing `mapServiceError`. No payload
  yet — when a slice needs the fresh rev for a smarter recovery
  path, extend the variant rather than adding a parallel error kind.
- **UI conflict recovery is "refetch + require re-save"**, not silent
  replay. On 409 the mutation invalidates the workspaces query and
  surfaces an inline amber message inside the dialog; the user
  re-confirms against the (now visible) concurrent values. Silent
  replay would hide real conflicts and can overwrite legitimate
  concurrent edits. Slice 3 may reopen this for codoc content where
  re-typing isn't acceptable.
- **Create vs update / `IdGenerator`**: `updateWorkspace` takes
  `{ id, name, description, expectedRev }` and does NOT call
  `ctx.idGen`. Only `create*` use cases mint ids — `IdGenerator`
  stays create-only, and every future `update*` copies this shape.
- **Fresh-rev read pattern**: after a 409, the UI reads the refetched
  rev from the react-query cache (`queryClient.getQueryData`) inside
  `handleEdit` before issuing the retry. The dialog holds the list
  item as a "sticky" reference but always re-reads the rev at submit
  time.

**Verification:** `/verify-fix` browser run exercised three paths:
(1) create → edit → save happy path, (2) stale-rev conflict forced
via a concurrent `curl` PATCH while the dialog was open (UI shows
the amber message, background card reflects the concurrent writer's
values), (3) second Save reads the refetched rev from the cache and
succeeds. API confirmed `rev` monotonicity r1 → r2 → r3 → r4.

---

## Slice 2 — workspace detail page

**Page:** `/workspace/:id` — workspace header (name, description,
updatedAt), tabs/sections, and a **codoc list** for that workspace.
Adds a `codocCount` badge to the slice-1 list cards.

**Why this slice:** first time we walk the full stack for a
**second** aggregate, on top of an aggregate the user already trusts.
It validates that all the slice-1 conventions (envelope, error map,
ports) generalise.

**Stores replaced:** `CodocStore` (full impl — `get`, `listByWorkspace`,
`create`, `delete`; `update` lands in slice 3).
**Stubs still in place:** `ThreadStore`, `AgentStore`, `ThreadCodocStore`,
`ThreadAgentStore`, `WorkspaceAgentStore`, `AgentSessionStore`.

**New use cases:**
- `getWorkspace`
- `listCodocsByWorkspace` (returns `CodocListItem` DTO — same nested
  pattern as `WorkspaceListItem`)
- `createCodoc` (use case mints `CodocId`; `IdGenerator.codocId()`
  added)
- `deleteCodoc` (no `CodocReferenced` path yet — there are no thread
  links to dangle)

**Slice-1 list page is upgraded** with a `codocCount` per card,
fetched alongside `listWorkspaces`. The shape decision lives here:
either fold counts into `WorkspaceListItem` (server-computed in the
use case) or fetch them client-side per workspace. **Decision to
make in this slice and document in `usecases/workspace/AGENTS.md`.**

**New routes:**
- `GET /api/workspaces/:id`
- `GET /api/workspaces/:id/codocs`
- `POST /api/workspaces/:id/codocs`
- `DELETE /api/codocs/:id`

**Legacy reference:** `legacy/apps/web/src/pages/workspace-detail.tsx`
(strip presets, agents, graph, chat — those are slices 4–6).

**Verification:** `/verify-fix` — open workspace, create a codoc, see
the count badge update on the list page, delete the codoc, see the
badge decrement.

---

## Slice 3 — codoc detail + edit page — DONE

**Why this slice existed:** first heavyweight `Rev`/`Conflict`
workflow on a non-trivial document. The editor binds to raw
`content` and saves with optimistic concurrency, so the conflict
recovery UX can't just throw the user's buffer away the way the
slice-1.5 field-level dialog does.

**Page:** `/workspace/:workspaceId/codoc/:codocId` — header, path,
"last edited", textarea-backed content editor, Save button with
inline conflict warning. Codoc cards on the workspace detail page
upgraded to link into this route.

**Stores upgraded:** `CodocStore.update` started being used (its
storage-memory impl already existed from slice 2).

**Use cases:** `getCodoc`, `updateCodocContent`.
**Routes:** `GET /api/codocs/:id`, `PUT /api/codocs/:id`.

**Conventions locked in** (documented in
`packages/service/src/usecases/codoc/AGENTS.md`):

- **`CodocDetail` DTO is flat** like `CodocListItem`, adding only
  `content: string`. The ast stays server-side — same `ReadonlyMap`
  JSON-serialisation problem that kept it off `CodocListItem`.
- **Content-only updates preserve the ast.** `updateCodocContent`
  reads the current `Codoc`, spreads `content` onto it, and writes
  it back. `ast.meta` / `ast.data` / `ast.view` round-trip
  unchanged. There is no MDX / YAML parser in the service layer yet
  (core forbids parsing at that layer); re-derivation from source
  is deferred to the slice that introduces a dedicated parser
  helper.
- **Long-form conflict recovery keeps the editor buffer.** On 409
  the detail query is invalidated so the cache holds the fresh
  `rev`, but the textarea state is **not** reset. The page shows an
  inline amber warning with two choices: Save again (deliberate
  overwrite, uses the fresh rev from the cache) or Reload from
  server (explicit opt-in to discard the draft). Slice 1.5's
  force-refetch recovery is still the rule for small dialog edits;
  this adds a parallel pattern for long-form content.
- **URL addresses the codoc by opaque id**, not by `CodocPath`
  splat. Ids are stable across path rename and already sit on the
  `CodocListItem` the workspace detail page renders, so the path
  splat the original slice plan called for would be redundant
  indirection.

**Deferred** (recorded in `usecases/codoc/AGENTS.md`):

- **`PATCH /api/codocs/:id/data`** — no UI need yet.
- **dag rebuild inside the use case + `nodeState` on the DTO.**
  Without a parser populating `ast.data`, every codoc has zero
  data fields; calling `buildDAG` would produce an empty DAG every
  time and every `nodeState` projection would be uniformly empty.
  Wiring dead code through the stack for the sake of "locking in
  the pattern" violates the "only what's clearly necessary" rule.
  The slice that introduces the MDX parser is the natural place to
  thread dag through `updateCodocContent` — signatures don't need
  to change for that to land.

**Verification:** `/verify-fix` browser run — opened a workspace,
created a codoc, edited its content, saved, confirmed the detail
page and the workspace list both reflected the new `updatedAt`.
Forced a 409 via a concurrent `curl` PUT against the same id while
the editor held an unsaved draft; confirmed the amber warning
appeared, the draft survived, and the next Save wrote the draft
against the fresh rev. Also confirmed Reload-from-server discards
the draft.

**Legacy reference:** `legacy/apps/web/src/pages/codoc-detail.tsx`
(stripped — no MDX rendering, no view actions, no status badge,
no chat integration; those are slices 4–6).

---

## Slice 4 — chat threads (no agents yet)

**Page:** thread list inside the workspace detail page + a basic
thread page that lists messages and lets the user manually append
a user message. **No agent activation, no streaming, no tool calls.**

**Why this slice:** first time we exercise an aggregate with an
**append-only child collection** (`ChatMessage` rows under
`ChatThread`). It validates the `ThreadStore.appendMessage` contract
(monotonic `seq`, atomic assignment) without dragging the entire
agent runtime in. The thread page becomes the test bed slices 5/6
will mount agent UI on.

**Stores replaced:** `ThreadStore` (full impl — `get`, `listByWorkspace`,
`create`, `update`, `delete`, `appendMessage`, `listMessages`).

**Stubs still in place:** `AgentStore`, `ThreadCodocStore`,
`ThreadAgentStore`, `WorkspaceAgentStore`, `AgentSessionStore`.

**New use cases:**
- `listThreadsByWorkspace`
- `createThread` (use case mints `ThreadId` via `IdGenerator.threadId()`)
- `deleteThread`
- `getThread` (returns `{ thread, messages }` — first multi-fetch
  use case; sets the pattern for "page bundle" DTOs)
- `appendUserMessage` — synchronous, no agent. Use case mints
  `MessageId` and lets the store assign `seq`.

**New conventions to lock in:**
- "page bundle" DTO pattern (`{ thread, messages }`) vs "fetch
  separately" — slice 4 should pick **one** and document it in
  `usecases/AGENTS.md` so slice 6 doesn't reinvent it
- how `seq` is exposed on the wire
- whether `listMessages` ever needs cursoring before slice 6
  (probably not — defer)

**New routes:**
- `GET /api/workspaces/:id/threads`
- `POST /api/workspaces/:id/threads`
- `DELETE /api/threads/:id`
- `GET /api/threads/:id`
- `POST /api/threads/:id/messages` *(synchronous append, returns the
  stored message; no streaming)*

**Legacy reference:** the thread list area of
`legacy/apps/web/src/pages/workspace-detail.tsx` and the message log
of `legacy/apps/web/src/pages/chat-page.tsx` (strip everything to do
with agents, codoc context, SSE, and the canvas panel).

**Verification:** `/verify-fix` — create a thread, append a few user
messages, reload, delete the thread, confirm cascade (messages
gone).

---

## Slice 5 — agent activation + agent turn (the big one)

**Page:** the slice-4 thread page gains a real chat surface — agent
picker, codoc context picker, and a **streaming agent turn** when the
user sends a message.

**Why this slice:** this is where the rewrite earns its keep. It
exercises the entire runtime stack: `@cobook/graph` (agents,
runtime, tool execution), `@cobook/chat` (chat-specific
specialisation), the SSE transport, all four chat-related stores
(`AgentStore`, `WorkspaceAgentStore`, `ThreadAgentStore`,
`ThreadCodocStore`), session state on `AgentSessionStore`, and the
"use cases are the only place that imports `@cobook/graph` /
`@cobook/chat`" rule from `usecases/AGENTS.md`. If anything in the
service-layer ports / framework-contract design is wrong, this is
the slice that finds out.

**Stores replaced:** `AgentStore`, `WorkspaceAgentStore`,
`ThreadAgentStore`, `ThreadCodocStore`, `AgentSessionStore`. After
this slice, the only stub left is whatever `@cobook/storage-memory`
hasn't needed yet (probably nothing).

**New use cases (rough — refine in slice planning):**
- `listAgents` (global agent listings)
- `setWorkspaceAgents` (idempotent link/unlink)
- `setThreadAgents` (idempotent link/unlink)
- `setThreadCodocs` (idempotent link/unlink with workspace mismatch
  check from the store)
- `runAgentTurn` — composite use case. Opens a single transaction,
  reads thread / context / agents, hands off to `@cobook/chat`'s
  runtime, persists the assistant message + any session state
  updates, emits SSE events to the caller. **First slice to use
  `withTransaction` non-trivially.**
- adds an `agentCount` badge on the slice-1 list page (mirrors the
  slice-2 `codocCount` upgrade)

**New conventions to lock in:**
- how the SSE transport wraps the runtime's event stream (event
  envelope shape, error events, abort handling)
- how the runtime gets a `ServiceCtx`-shaped scope without
  `@cobook/graph` knowing what `ServiceCtx` is (the framework
  contract from `memory/project_framework_contracts_stay_generic.md`
  meets reality here)
- how aborted streams are reflected in `AgentSessionStore` so
  reconnection works
- how `Conflict<"session">` is surfaced (probably retry-with-fresh-rev
  inside the use case; agent turns are not user-facing optimistic
  concurrency)

**New routes:**
- `GET /api/agents`
- `PUT /api/workspaces/:id/agents`
- `PUT /api/threads/:id/agents`
- `PUT /api/threads/:id/codocs`
- `POST /api/threads/:id/messages` *(now SSE; supersedes the
  synchronous variant from slice 4 — slice 4's route either becomes
  the fallback or goes away, decided in this slice)*
- `GET /api/threads/:id/stream` *(reconnect)*

**Legacy reference:** `legacy/apps/web/src/pages/chat-page.tsx`,
`legacy/apps/web/src/components/chat/*`,
`legacy/apps/web/src/api/chat.ts`. AI Elements arrives in the UI
**here** (per `memory/project_ai_elements_adoption.md`) — slice 5 is
where the chat surface is built and is the right time to take the
dependency.

**Verification:** `/verify-fix` — activate agents in a workspace,
attach codoc context to a thread, send a message, watch the streaming
response, abort mid-stream, reconnect, send another. Run a multi-turn
conversation that exercises tool calls if any agent in the seed
catalog has them.

This slice is intentionally large because the cost of splitting it is
mocking the runtime against a fake transport, which is the exact
thing vertical slicing exists to avoid. If it turns out unmanageable
during planning, the split will be **(5a) static activation + manual
synchronous turn** and **(5b) streaming + reconnect**, not a
horizontal split.

---

## Slice 6 — presets (cross-domain transactional + SSE progress)

**Page:** preset gallery on the slice-1 list page — pick a preset,
optionally pick agents, click "create" and watch a progress stream
fill in steps as the workspace, codocs, dag, agents, and seed thread
are created.

**Why this slice last:** presets touch **every** aggregate the
previous slices put in place. They are the final integration test
for the entire vertical stack and the reason why none of the earlier
slices needed to invent a "this use case actually creates four
things" pattern — slice 6 is where that pattern lands.

**Stores upgraded:** none new. Slice 6 only adds a preset registry
(probably a static module under `@cobook/service` or a tiny new
package — decided in slice planning) and a single composite use
case.

**New use cases:**
- `listPresets` — pure read of the registry
- `createWorkspaceFromPreset` — single transaction, single use case,
  emits progress events through an injected `ProgressSink`-style
  port. The use case is the only place that sees the registry; the
  registry is the only place that knows preset structure.

**New conventions to lock in:**
- how progress events are typed and how they map onto SSE
- whether the preset registry is data (JSON) or code (TS modules);
  decision documented in the registry's own `AGENTS.md`
- the cross-aggregate transaction shape — this is the canonical
  example future composite use cases (slice 7+) will copy

**New routes:**
- `GET /api/presets`
- `POST /api/workspaces/from-preset` *(synchronous — for simple
  presets and tests)*
- `POST /api/workspaces/from-preset/stream` *(SSE with progress)*

**Legacy reference:** `legacy/apps/web/src/api/workspace.ts`'s
`createWorkspaceFromPreset` / `createWorkspaceFromPresetStream` plus
whichever preset definitions live under
`legacy/packages/server/src/presets` (need to confirm in slice
planning).

**Verification:** `/verify-fix` — pick a non-trivial preset, run it,
watch progress, navigate into the resulting workspace, confirm every
created object is real (codocs visible, dag built, agents activated,
seed thread present). Re-run the same preset and confirm the
workspace name disambiguation. Force a mid-stream failure and
confirm the transaction rolls back (no orphan workspace).

---

## After slice 6

Once slice 6 ships, the vertical stack is complete on top of
in-memory storage. The next major work item is `@cobook/storage-pg`
— the PG-backed adapter implementing the same `Storage` port that
`@cobook/storage-memory` already implements. Switching the
composition root to use PG instead of memory should be a one-line
change in `apps/server/src/index.ts`. If it isn't, the abstraction
leaked somewhere and we fix it before declaring slice 6 done.

Auth / capability checks land **after** the PG migration —
`usecases/AGENTS.md` already reserves the first line of every use
case for them.

## How to update this file

When a slice ships, replace its section with the actual scope, the
actual stores it touched, and the actual conventions it locked in.
The "Why this slice" framing is retained as a paragraph so the next
slice planning session has the rationale on hand.

When a slice's scope drifts during planning, **edit this file in the
same PR** so the roadmap stays a single source of truth instead of
calcifying.
