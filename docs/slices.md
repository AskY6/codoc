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

## Slice 1.5 — workspace edit (PATCH)

**Why this exists:** the optimistic-concurrency path (`Rev` /
`expectedRev` / `Conflict`) is the most subtle thing in the storage
contract. It is much cheaper to debug it on the simplest possible
field-level edit (a workspace name) than on a 2 000-line codoc
document. This slice's only job is to put `Rev` end-to-end on the
table — every later update flow copies it.

**Page:** in-place name + description edit on the slice-1 list cards
(no new page).
**Stores upgraded:** `WorkspaceStore.update` already exists from
slice 1; the slice exercises it from a real consumer for the first
time.
**New conventions to lock in:**
- where `Rev` lives in the DTO envelope (almost certainly inside the
  `WorkspaceListItem` shape, surfaced as opaque opaque-typed `string`
  on the wire)
- how `Conflict<*>` shows up in the HTTP envelope and how the UI
  reacts (refetch + replay edit, or surface a "someone else changed
  this" toast — pick one and document it)
- how the create-vs-update split surfaces in `IdGenerator`-style
  ports (it doesn't — update takes the id, but the slice should still
  prove that out)

**Use cases:** `updateWorkspace`.
**Routes:** `PATCH /api/workspaces/:id`.
**Verification:** `/verify-fix` — edit a workspace, refresh, edit
again with a stale `expectedRev` from devtools and confirm the UI
recovers.

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

## Slice 3 — codoc detail + edit page

**Page:** `/workspace/:id/codoc/*` — view a codoc, edit its content,
save with optimistic concurrency.

**Why this slice:** first heavyweight `Rev`/`Conflict` workflow on a
non-trivial document. Also the first slice to exercise `@cobook/core`'s
`dag/` module from a real consumer — saving a codoc must
recompute the dag and reflect the new node state in the UI.

**Stores upgraded:** `CodocStore.update` (was already typed in slice
2 but unused). No new stubs replaced.

**New use cases:**
- `getCodoc`
- `updateCodocContent` — takes `{ id, content, expectedRev }`,
  returns the new `StoredCodoc` (with refreshed `Rev`)
- `patchCodocData` — JSON patch path, only if the legacy page actually
  needs it for slice 3's verification (otherwise defer)
- dag rebuild logic — moved into the use case via a pure helper from
  `@cobook/core/dag`

**New conventions to lock in:**
- how `Conflict<"codoc">` is surfaced to the UI (toast + refetch +
  re-apply local edits, or hard-stop with a diff view — pick one)
- where dag computation lives (use case orchestrates;
  `@cobook/core/dag` is the pure function)
- how `nodeState` is exposed in the DTO

**New routes:**
- `GET /api/codocs/:id`
- `PUT /api/codocs/:id` (full content replace)
- `PATCH /api/codocs/:id/data` *(only if needed for verification)*

**Legacy reference:** `legacy/apps/web/src/pages/codoc-detail.tsx`
plus the `CodocViewer` component for the visual.

**Verification:** `/verify-fix` — edit a codoc, save, reload, edit
twice in two browser tabs and confirm the second save reports a
conflict and recovers.

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
