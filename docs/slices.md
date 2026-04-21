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

## Slice 4 — chat threads (no agents yet) — DONE

**Why this slice existed:** first time we exercise an aggregate with
an **append-only child collection** (`ChatMessage` rows under
`ChatThread`). It validates the `ThreadStore.appendMessage` contract
(monotonic `seq`, atomic assignment) without dragging the entire
agent runtime in. The thread page becomes the test bed slices 5/6
will mount agent UI on.

**Page:** Chats section on the workspace detail page +
`/workspace/:workspaceId/chat/:threadId` page with a scrollable
message transcript and a textarea + Send button that appends user
messages synchronously. "New chat" creates a thread with `title:
null` and navigates into it immediately. **No agent activation, no
streaming, no tool calls** — slice 5's job.

**Stores replaced:** `ThreadStore` (full impl — `get`, `listByWorkspace`,
`create`, `update`, `delete`, `appendMessage`, `listMessages`). The
in-memory impl keeps an explicit `seqByThread: Map<ThreadId, number>`
counter rather than deriving from `messages.length` so future
per-message delete doesn't silently break monotonicity. Workspace
cascade wipes threads + their message logs via the same
`cascadeDelete*` hook pattern slice 2 introduced for codocs.

**Stubs still in place:** `AgentStore`, `ThreadCodocStore`,
`ThreadAgentStore`, `WorkspaceAgentStore`, `AgentSessionStore`.

**Use cases:** `listThreadsByWorkspace`, `createThread`,
`deleteThread`, `getThread`, `appendUserMessage`.
**Routes:** `GET/POST /api/workspaces/:id/threads`,
`GET/DELETE /api/threads/:id`, `POST /api/threads/:id/messages`.

**Conventions locked in** (documented in
`packages/service/src/usecases/thread/AGENTS.md`):

- **DTOs nest the canonical core type.** `ThreadListItem` wraps
  `ChatThread`, `ThreadMessage` wraps `ChatMessage`, same as
  `WorkspaceListItem` wraps `Workspace`. `CodocListItem`'s flattened
  shape remains the documented exception (because `Codoc.ast` holds
  `ReadonlyMap`s that don't survive `JSON.stringify`). Default is
  still "nest the canonical type".
- **Page-bundle DTO pattern.** `getThread` returns
  `{ thread: ThreadListItem, messages: readonly ThreadMessage[] }`
  in a single use case and a single HTTP round-trip. Alternative
  (two parallel queries for header + messages) rejected because the
  two pieces are always loaded together, one round-trip halves the
  latency, and concurrent `appendMessage` between internal calls is
  harmless. This is the reference shape for any future multi-fetch
  use case (slice 5's `run-agent-turn` bundle, slice 7's
  `createWorkspaceFromPreset` bundle).
- **`seq` is on the wire.** `ThreadMessage.seq: number` is a
  thread-local monotonic integer assigned by
  `ThreadStore.appendMessage`. Combined with `message.id` it is the
  canonical cursor for pagination. No cursoring added in slice 4
  (in-memory store returns the full log) but the shape is frozen so
  the slice that needs pagination only adds query-string parameters,
  not a new DTO.
- **`appendMessage` does NOT bump `thread.updatedAt`.** The
  `ThreadStore.update` and `ThreadStore.appendMessage` methods have
  distinct contracts; only `update` stamps `updatedAt` / allocates
  a new `Rev`. A thread with 100 messages still has the `updatedAt`
  of its last rename. If a future slice wants "sort by last message
  time", the right fix is to expose a `lastMessageAt: number | null`
  on `ThreadListItem` computed as a pure-read join, not as a side
  effect of `appendMessage`.
- **Append uses `ctx.idGen.messageId()`.** The use case mints
  `MessageId`, the store assigns `seq` atomically. Same rule as
  every other create use case. `MessageAlreadyExists` is therefore
  structurally unreachable under a correct `IdGenerator`, but the
  variant is listed in the error union + HTTP mapping + wire shape
  so the ADT is frozen now; slice 5 may reach it via runtime session
  replay.
- **Long-form conflict recovery is not re-used yet.** `ThreadStore.update`
  is implemented but no slice 4 use case calls it — inline rename
  lands with slice 5 or later and will follow the slice-1.5
  short-field "force refetch, require re-save" pattern, not slice 3's
  long-form recovery.

**Deferred** (recorded in `usecases/thread/AGENTS.md`):

- **`updateThread` use case.** No slice 4 UI path renames a thread.
- **Auto-title from first message.** Slice 4 creates threads with
  `title: null` and the UI shows "Untitled". A later slice may
  populate the title on append, but that belongs on append, not on
  create, so empty threads stay "Untitled".
- **`listMessages` pagination.** `ListMessagesOptions` already defines
  `afterSeq` / `limit` on the port and the in-memory store honours
  them, but no use case exposes them. Pagination lands when the
  slice that needs it adds query-string parsing.
- **`threadCount` on `WorkspaceListItem`.** Out of scope. Slice 5
  adds `agentCount`; if a later slice wants `threadCount` it mirrors
  that upgrade with a new pure-read join method on `threadRepo`.

**Verification:** curl smoke test walked the full CRUD —
create workspace → empty list → create thread → list shows it →
`getThread` returns `{ thread, messages: [] }` → append user message
(seq=1, user variant on the wire) → `getThread` now returns the
message → separately, workspace cascade delete wiped a thread +
message through the new `cascadeDeleteThreads` hook (thread-not-found
on `getThread` after workspace DELETE). Full service test suite
passes (47 tests) and workspace typecheck is clean across all 14
packages.

**Legacy reference:** the thread list area of
`legacy/apps/web/src/pages/workspace-detail.tsx` and the message log
of `legacy/apps/web/src/pages/chat-page.tsx` (stripped — no agent
picker, no codoc context, no SSE, no canvas panel; those are
slices 5–6).

---

## Slice 5 — agent activation + agent turn — DONE

**Why this slice:** this is where the rewrite earns its keep. It
exercises the entire runtime stack: `@cobook/graph` (agents,
runtime, tool execution), `@cobook/chat` (chat-specific
specialisation), the SSE transport, all five remaining stores, and
the "use cases are the only place that imports `@cobook/graph` /
`@cobook/chat`" rule.

Split into **5a** (static activation + synchronous turn) and **5b**
(SSE streaming + reconnect + auto-title). Full plan in
`docs/slice-5-plan.md`.

**Stores replaced:** `AgentStore`, `WorkspaceAgentStore`,
`ThreadAgentStore`, `ThreadCodocStore`, `AgentSessionStore`. No stubs
remain after this slice.

**Use cases:**
- `listAgents`, `listWorkspaceAgents`
- `setWorkspaceAgents`, `setThreadAgents`, `setThreadCodocs`
  (idempotent diff reconciliation)
- `runAgentTurn` — composite use case: reads thread + agents + codocs,
  persists user msg, builds graph (router + specialists), runs turn
  via `@cobook/chat`, persists assistant msgs. Optional `onEvent`
  callback for SSE streaming; optional `signal` for abort.
- `updateThread` — update thread title with optimistic concurrency
  (used by auto-title)

**Routes:**
- `GET /api/agents`
- `PUT /api/workspaces/:id/agents`
- `PUT /api/threads/:id/agents`
- `PUT /api/threads/:id/codocs`
- `POST /api/threads/:id/turn` — SSE streaming agent turn
- `GET /api/threads/:id/stream` — reconnect to in-progress stream

**Conventions locked in:**
- **SSE event envelope:** `event: token|toolCall|toolResult|done|title-update|error`,
  `data: JSON`. At most one active stream per thread; concurrent
  requests rejected with 409. Active stream tracking with event
  buffering for reconnect.
- **`onEvent` streaming callback on use cases.** The use case both
  collects events internally (for persistence) and forwards to the
  optional callback in real-time. Callers (SSE route) wire the
  callback; the use case stays transport-agnostic.
- **Auto-title.** After first assistant response on a title-less
  thread, Haiku generates a short title (max 6 words). Fire-and-forget
  — failure is silently ignored. Emits `title-update` SSE event.
- **`@cobook/chat` dependency on server.** The server imports from
  `@cobook/chat` for `createAnthropicLlmClient` (used in auto-title
  route) and the `ChatEvent` type (for SSE mapping). This is the only
  place besides `@cobook/service` that touches `@cobook/chat`.
- **Web SSE client uses `fetch` + `ReadableStream`**, not `EventSource`
  (because the turn endpoint is POST). Token accumulation in local
  React state for optimistic streaming bubble; on `done`, invalidate
  the thread query to swap in canonical server messages. Stop button
  aborts the fetch controller.
- **CodocStore.delete referrer check.** Already wired via
  `threadCodocs.__threadIdsForCodoc` in `createMemoryStorage`. Codoc
  delete returns `codoc-referenced` when threads still pin it.

**Legacy reference:** `legacy/apps/server/src/routes/chat-routes.ts`
(SSE streaming, active stream tracking, auto-title).

**Verification:** typecheck + build clean across all packages. Browser
verification for streaming UI, stop button, auto-title, reconnect.

---

## Slice 6 — $ref resolution + DAG validation — DONE

**Page:** no new page. The codoc detail view (slice 3) gains
**resolved data values** — frontmatter `$ref` references are
replaced with actual numbers/strings from the referenced codocs
before the MDX renderer sees them.

**Why this slice:** the perf-review agent already produces
codocs with `$ref` links (`calibration/` → `reviews/` → `perf/`).
Without resolution, the calibration matrix shows all zeros. This is
the first time real users hit the wall — the format promised
cross-codoc references but the runtime doesn't deliver. Presets
(slice 7) will also benefit from working `$ref` when seeding
interconnected codocs.

**What landed:**

1. **`resolvedData` on `CodocDetail`.** Both the service and web
   `CodocDetail` DTOs gained `resolvedData: Record<string, unknown> | null`.
   Static values pass through; refs resolve 1-level deep (target must
   be static, otherwise `null`); sources are `null`. `null` when the
   codoc has no data fields or every resolved value is `null`.

2. **Resolution on read.** `getCodoc` delegates to
   `codocRepo.getDetailResolved`, which fetches all workspace siblings,
   builds an AST lookup map, and runs `resolveDataFields` before
   returning the detail DTO. Always fresh, no caching.

3. **DAG validation on write.** `updateCodocContent` calls `validateDAG`
   after a successful write. `buildDAG` + `checkCycles` from
   `@cobook/core` run against the full workspace AST set. Unknown
   targets and cycles are logged as warnings — neither fails the
   update. A codoc referencing a not-yet-created target is saveable;
   the ref resolves to `null` until the target exists.

4. **Web view mode.** The `MdxRenderer` receives
   `codoc.resolvedData ?? parsed.data` — server-resolved values in
   view mode, client-side parse in edit-mode preview.

**Stores upgraded:** none new. Resolution uses the existing
`CodocStore.listByWorkspace` for sibling lookup.

**New files:**
- `packages/service/src/usecases/codoc/resolve.ts` —
  `resolveDataFields`, `toAstMap`, `validateDAG`

**Use cases upgraded:**
- `getCodoc` → delegates to `getDetailResolved`
- `updateCodocContent` → DAG validation + resolvedData on response

**New routes:** none (existing routes, richer DTOs).

**Conventions locked in** (documented in
`packages/service/src/usecases/codoc/AGENTS.md`):

- **Resolution depth: 1 level.** A ref resolves to the target's static
  value. If the target is itself a ref or source, the result is `null`.
  No transitive chains, no recursive resolution.
- **Resolution errors → `null`.** Missing codoc, missing field,
  non-static target → `null` in `resolvedData`. No error propagation
  to the client; no failure on the API call.
- **DAG is ephemeral.** Not persisted. Rebuilt per request. A caching
  layer can be added later without changing any signatures.

**Deferred:**
- **Source field execution.** `source` fields resolve to `null`.
  The execution engine is a future slice.
- **DAG persistence / caching.** Currently rebuilt per request.
- **`PATCH /api/codocs/:id/data`** — no UI need yet.

**Verification:** typecheck clean across all packages. 77 tests pass
(18 test files) including 9 new unit tests for `resolveDataFields` and
3 new integration tests for `$ref` resolution through the full use
case stack.

---

## Slice 7 — presets (cross-domain transactional + SSE progress)

**Page:** preset gallery on the slice-1 list page — pick a preset,
optionally pick agents, click "create" and watch a progress stream
fill in steps as the workspace, codocs, dag, agents, and seed thread
are created.

**Why this slice last:** presets touch **every** aggregate the
previous slices put in place. They are the final integration test
for the entire vertical stack and the reason why none of the earlier
slices needed to invent a "this use case actually creates four
things" pattern — slice 7 is where that pattern lands.

**Stores upgraded:** none new. Slice 7 only adds a preset registry
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
  example future composite use cases (slice 8+) will copy

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

## After slice 7

Once slice 7 ships, the vertical stack is complete on top of
in-memory storage. The next major work item is `@cobook/storage-pg`
— the PG-backed adapter implementing the same `Storage` port that
`@cobook/storage-memory` already implements. Switching the
composition root to use PG instead of memory should be a one-line
change in `apps/server/src/index.ts`. If it isn't, the abstraction
leaked somewhere and we fix it before declaring slice 7 done.

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
