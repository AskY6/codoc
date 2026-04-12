# agents/

Concrete `ChatAgent` implementations — the agent catalog for the chat runtime.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../state/`](../state/AGENTS.md), [`../runner/`](../runner/AGENTS.md) (for `ChatRunContext`), [`../tools/`](../tools/AGENTS.md), `@cobook/core`, `@cobook/graph`.
Must never import from: `../adapter/`.

## Why this subtree exists

`@cobook/graph` defines the generic `Agent<S, E>` contract (a `GraphNode` with name, model, system prompt, and tools). `../state/` binds it to `ChatAgent`. This directory owns the **concrete agent instances** — the nodes that actually run inside a chat-turn graph.

Each agent's `run(state, ctx)` casts the generic `NodeContext<ChatEvent>` to `ChatRunContext` (from `../runner/context.ts`) to access the `llm` client. This structural-typing cast is the only coupling between agents and the runner subtree.

## Modules

| File | What it owns |
|---|---|
| `router.ts` | `createRouterAgent` — Haiku structured-output classifier. No tools. Reads latest user message, returns `{ activeAgent }` as state update. The graph's conditional edge dispatches to the chosen specialist. |
| `general.ts` | `createGeneralAgent` — Sonnet specialist with platform tools. Default fallback when the router has no clear match. |
| `rss.ts` | `createRssAgent` — Sonnet specialist with platform + RSS tools. RSS-specific system prompt. |
| `run-tool-loop.ts` | Shared tool-call loop used by general, RSS, and perf-review specialists. Calls LLM → executes tool_use blocks → feeds results back → repeats until final text or max 10 iterations. Internal helper, not exported from the package. |
| [`perf-review/`](perf-review/AGENTS.md) | Performance review specialist — two-phase (individual review + calibration). Rubric is configurable via `rubric.ts`. |

## Hard invariants

1. **The tool-call loop lives inside `run()`, not in the executor.** The graph executor sees each agent as a single-step node. The agent's internal LLM↔tool loop is transparent to the graph — it produces one `Partial<ChatState>` when done.
2. **Router is a pure classifier.** It never produces user-visible text. Its only state update is `{ activeAgent }`. If you feel the urge to make the router call tools or stream tokens, you are re-opening a settled design decision.
3. **Agents do not import `@anthropic-ai/sdk`.** They use the vendor-neutral `LlmClient` interface from `../runner/context.ts`. Only `../runner/llm-adapter.ts` touches the SDK.
4. **Each specialist emits a `done` event with a `ChatMessage`.** The `done` event carries the final `ChatMessage { kind: "assistant", agentId, metadata: { toolCalls } }`. The service layer extracts these via `eventsToAssistantMessages` and persists them.
5. **`mintMessageId` comes from context.** Agents get message ids from `ctx.mintMessageId()`, not by importing `IdGenerator`. The service layer supplies this function when constructing `ChatRunContext`.
