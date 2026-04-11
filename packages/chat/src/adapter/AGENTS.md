# adapter/

The **translation layer** between the persistence-facing `ChatMessage` ADT in `@cobook/core` and the graph-facing `ChatState` / `ChatEvent` shapes in `../state/`.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../state/`](../state/AGENTS.md), `@cobook/core`.
Must never import from: [`../runner/`](../runner/AGENTS.md), `@cobook/graph` directly. The graph types arrive here through `../state/`'s aliases.

## Why this subtree exists

The thread the user sees is a list of `ChatMessage`s; the graph executor works on `ChatState` and streams `ChatEvent`s. Something has to turn one into the other. Keeping that translation in its own subtree means:
- the runner in `../runner/` doesn't grow a pile of ad-hoc conversion helpers
- the translation rules are in one place when the `ChatMessage` ADT grows a new variant or the `ChatEvent` union gains a new kind
- tests for the adapter are isolated from tests for the runner

## Modules

| File | What it owns |
|---|---|
| `adapter.ts` | `buildInitialState` (inbound) and `eventsToAssistantMessages` (outbound) — the two directions of the translation |

## Hard invariants

1. **Pure.** Adapter functions do no I/O, hold no state, and throw no exceptions. Structured failure cases (if any emerge) become `Result` variants on their return types.
2. **Outbound fold, not broadcast.** `eventsToAssistantMessages` reduces an event *history* into a message list. Live streaming — "here is a token delta, here is another" — is the runner's job. The adapter does not own a callback-based API; it is a batch transformer.
3. **One alias site.** This subtree reads `ChatState` / `ChatEvent` from `../state/`. It does **not** import `Tool<...>` or `Agent<...>` from `@cobook/graph` directly; if it ever needs the runtime tool/agent contracts, it reads the `Chat*` aliases from `../state/` and lets the binding stay there.
4. **Lossy-by-design is explicit.** `eventsToAssistantMessages` is allowed to drop events that have no persistent representation (e.g. token deltas that were only meaningful for streaming). Where the adapter drops information, it should say so in a comment on the variant it drops.
