# runner/

The **chat turn runner** — the outermost subtree inside `@cobook/chat`. This is the entry point a service layer calls to execute one chat turn against a chat-bound graph.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../state/`](../state/AGENTS.md), [`../adapter/`](../adapter/AGENTS.md), `@cobook/graph`, `@cobook/core`.
Must never import from: nothing (this is the outermost subtree).

## Why this subtree exists

`@cobook/graph` exposes a generic `runGraph` that returns a `Result`. A service layer could call it directly, but doing so every time would mean repeating the "seed a `ChatState`, call `runGraph`, collect events, fold into messages" dance at every call site. `runner/` is that dance, written once, with the concrete chat types baked in.

It is **thin on purpose**: this subtree does not own the graph topology (that's the service layer's job — it picks which agents / tools to wire together), and it does not own the translation rules (that's `../adapter/`). It only owns the orchestration.

## Modules

| File | What it owns |
|---|---|
| `runner.ts` | `runChatTurn` — the end-to-end driver for a single chat turn |

## Hard invariants

1. **Runner does not build the graph.** The caller hands a pre-validated `ChatGraph` (the alias for `Graph<ChatState, ChatEvent>` exported from `../state/`) in. Building and validating graphs is an upstream concern (the service layer), not the runner's.
2. **Runner does not seed state.** The caller hands a `ChatState` in — typically produced by `../adapter/buildInitialState`. Keeping seeding out of the runner means the same runner can drive a fresh turn, a replay, or a test scenario without sprouting constructor overloads.
3. **Runner does not fold events into messages.** It streams events through the caller-supplied `onEvent` callback and returns the raw `ExecutionResult`. Turning events into `ChatMessage`s for persistence is `../adapter/eventsToAssistantMessages`' job. This split keeps streaming and persistence on separate code paths so one can change without touching the other.
4. **One function, one contract.** If a new variant of "run a turn" appears (dry-run, replay, multi-turn), add it as a new top-level function — don't grow options on `runChatTurn` until the set of knobs stabilises.
5. **Errors are `Result` variants.** The runner returns `Result<ExecutionResult, RunGraphError>`. It does not throw on structured failure; only unexpected failures (e.g. the caller passing a corrupt state) are allowed to propagate as thrown values.
