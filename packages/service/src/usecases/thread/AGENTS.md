# service / usecases / thread

Use cases that act on the chat-thread aggregate.

Parent: [`../AGENTS.md`](../AGENTS.md) — full use case rules.
See also: [`../workspace/AGENTS.md`](../workspace/AGENTS.md) and
[`../codoc/AGENTS.md`](../codoc/AGENTS.md) — the reference aggregates
whose envelope / rev / error conventions the thread aggregate copies.

## Contents

| File | Purpose |
|---|---|
| `list-threads-by-workspace.ts` | Return every thread in a workspace as a `ThreadListItem`. Fails with `workspace-not-found` when the owning workspace is missing. |
| `create-thread.ts` | Mint a thread under a workspace from `{ workspaceId, title }`. Use case owns the `ThreadId`; transports never supply one. |
| `delete-thread.ts` | Delete a thread by id. Storage wipes the message log atomically as part of the same call. |
| `get-thread.ts` | Return a "page bundle" — the thread envelope plus its full message log — in one use case. |
| `append-user-message.ts` | Append a `kind: "user"` message to a thread. Use case mints the `MessageId`; storage assigns `seq` atomically. |
| `update-thread.ts` | Update a thread's mutable fields (title) with optimistic concurrency. Used by SSE auto-title and future manual renames. |

## Locked-in conventions

These are the new patterns slice 4 adds to the service layer. They
are additive to the conventions already locked in by the workspace
and codoc aggregates.

### DTOs nest the canonical core type

`ThreadListItem` wraps `ChatThread`, and `ThreadMessage` wraps
`ChatMessage`, the same way `WorkspaceListItem` wraps `Workspace`.
Unlike `CodocListItem` (which is flattened because `Codoc.ast` holds
`ReadonlyMap`s that don't survive `JSON.stringify`), both
`ChatThread` and `ChatMessage` are plain primitives / plain ADTs,
so nesting the core type is safe and keeps the wire shape symmetric
with the in-memory shape. The default is still "nest the canonical
type"; codoc is the documented exception.

### Page-bundle DTO pattern (`getThread`)

`getThread` returns `ThreadDetail`:

```ts
interface ThreadDetail {
  readonly thread: ThreadListItem;
  readonly messages: readonly ThreadMessage[];
}
```

A single use case and a single HTTP round-trip hydrate the entire
thread page. The alternative — two parallel queries
(`GET /threads/:id`, `GET /threads/:id/messages`) — was considered
and rejected for slice 4 because:

1. The two pieces are always loaded together. The thread page has
   no state where the header is visible but the messages are not.
2. One round-trip halves the latency and the client-side loading
   state.
3. Concurrent `appendMessage` between the two internal calls is
   harmless — the second call just picks up the fresh row, and the
   UI would have invalidated both queries anyway.

This is slice 4's reference shape for any future multi-fetch use
case. Slice 5's `run-agent-turn` is expected to return a similar
bundle (the new assistant message + any session state updates);
slice 6's `createWorkspaceFromPreset` is expected to stream progress
and then return a bundle of every created object.

### `seq` is on the wire

`ThreadMessage` carries a plain `seq: number`, a thread-local
monotonic integer assigned by `ThreadStore.appendMessage`. Clients
may use it as an opaque order key; combined with `message.id` it is
the canonical cursor for pagination. No cursoring in slice 4 — the
in-memory store returns the full log — but the shape is already on
the wire, so the slice that needs pagination only adds query-string
parameters, not a new DTO.

### `appendMessage` does NOT bump `thread.updatedAt`

`ThreadStore.appendMessage` and `ThreadStore.update` are distinct
methods with distinct contracts. `updatedAt` on the thread envelope
is stamped by `update` only. A thread that receives 100 messages
still has the `updatedAt` from its last rename (or creation). This
matches the port as written and avoids a subtle change-feed issue
where the message append path would have to allocate a new `Rev` as
a side effect.

If a future slice wants "sort threads by last message time", the
right fix is to expose a `lastMessageAt: number | null` field on
`ThreadListItem` — computed in the repo layer as a pure-read join,
not as a side effect of `appendMessage`.

### Append uses `ctx.idGen.messageId()`

The use case mints the `MessageId`, never the transport. This is
the same rule that already applies to create use cases for every
other aggregate; there's no reason a message append should be
different. `MessageAlreadyExists` is therefore structurally
unreachable under a correct `IdGenerator` — the variant is still
listed in the error union so the HTTP mapping, wire shape, and ADT
exhaustiveness check are frozen now (slice 5 may reach it via
runtime session replay).

## Deferred

- **Pagination on `listMessages`.** `ListMessagesOptions` already
  defines `afterSeq` and `limit` on the port, and the in-memory
  store honours them, but no use case exposes them yet. The slice
  that needs it only has to add query-string parsing at the route
  and thread the options through.
- **`threadCount` on `WorkspaceListItem`.** Out of scope per the
  slice 4 roadmap. Slice 5 adds `agentCount`; if a later slice
  wants `threadCount` it mirrors that upgrade, folding the count
  into `workspaceRepo.list` / `getListItem` via a new pure-read
  join method on `threadRepo`.
