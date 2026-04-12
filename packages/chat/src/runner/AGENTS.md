# runner/

The **chat turn runner** — the outermost subtree inside `@cobook/chat`. This is the entry point a service layer calls to execute one chat turn against a chat-bound graph.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../state/`](../state/AGENTS.md), [`../adapter/`](../adapter/AGENTS.md), `@cobook/graph`, `@cobook/core`.
Must never import from: `../tools/`, `../agents/` (those import from here, not the reverse).

## Why this subtree exists

`@cobook/graph` exposes a generic `runGraph` that returns a `Result`. A service layer could call it directly, but doing so every time would mean repeating the "seed a `ChatState`, call `runGraph`, collect events, fold into messages" dance at every call site. `runner/` is that dance, written once, with the concrete chat types baked in.

It is **thin on purpose**: this subtree does not own the graph topology (that's the service layer's job �� it picks which agents / tools to wire together), and it does not own the translation rules (that's `../adapter/`). It only owns the orchestration.

## Modules

| File | What it owns |
|---|---|
| `runner.ts` | `runChatTurn` — the end-to-end driver for a single chat turn. Thin wrapper over `runGraph` with chat-specific `maxSteps` default. |
| `context.ts` | `LlmClient` interface, vendor-neutral LLM types (`LlmMessage`, `LlmToolDef`, `LlmResponse`, etc.), and `ChatRunContext extends NodeContext<ChatEvent>` with `llm` + `mintMessageId`. This is the DI seam for LLM access. |
| `llm-adapter.ts` | `createAnthropicLlmClient` — the **only file in the new stack** that imports `@anthropic-ai/sdk`. Maps `LlmClient` calls to Anthropic Messages API. |

## Hard invariants

1. **Runner does not build the graph.** The caller hands a pre-validated `ChatGraph` in. Building and validating graphs is an upstream concern (the service layer), not the runner's.
2. **Runner does not seed state.** The caller hands a `ChatState` in — typically produced by `../adapter/buildInitialState`.
3. **Runner does not fold events into messages.** It streams events through `ctx.emit` and returns the raw `ExecutionResult`. Turning events into `ChatMessage`s is `../adapter/eventsToAssistantMessages`' job.
4. **One function, one contract.** If a new variant of "run a turn" appears (dry-run, replay, multi-turn), add it as a new top-level function.
5. **Errors are `Result` variants.** The runner returns `Result<ExecutionResult, RunGraphError>`. No throws on structured failure.
6. **`LlmClient` is vendor-neutral.** `context.ts` defines Anthropic-shaped types without importing the SDK. `llm-adapter.ts` is the only vendor-specific file. Adding a second provider means adding a second adapter, not touching `context.ts`.
7. **`ChatRunContext` is the extension point.** Agents access LLM and id-minting through `ChatRunContext`. If agents need new capabilities in the future, extend this interface — don't pass ad-hoc params.
