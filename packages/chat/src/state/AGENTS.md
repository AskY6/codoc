# state/

The **chat specialization** layer — the one place in this package (and in the entire codebase) where the generic `@cobook/graph` contracts get bound to the concrete chat state / event pair, and where the chat state / event types themselves are defined.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: `@cobook/graph`, `@cobook/core`.
Must never import from: [`../adapter/`](../adapter/AGENTS.md), [`../runner/`](../runner/AGENTS.md). Those siblings live *above* `state/` in the import direction — they read from here, not vice versa.

## Why this subtree exists

`@cobook/graph` is intentionally generic — its `Tool<S, E>` and `Agent<S, E>` don't know what chat is. Without this subtree, every downstream caller in `@cobook/chat` (adapter, runner, future built-in agents/tools) would have to repeat `Tool<ChatState, ChatEvent>` at every import, and swapping the state shape would mean editing every file. This subtree writes the binding **once** and re-exports thin `Chat*` aliases that downstream code uses instead.

It also owns the canonical `ChatState` / `ChatEvent` types themselves — there is no other home for them; `@cobook/graph` refuses to hold application-specific concepts.

## Modules

| File | What it owns |
|---|---|
| `state.ts` | `ChatState` — the state flowing through a single chat turn |
| `events.ts` | `ChatEvent` discriminated union streamed out of the executor |
| `reducers.ts` | `chatReducers` — the canonical `StateReducers<ChatState>` table |
| `aliases.ts` | `ChatTool`, `ChatAgent`, `ChatToolRegistry`, `ChatAgentRegistry`, `ChatGraph` — the single binding site for the `<S, E>` pair |

## Hard invariants

1. **This is the *only* file where `<ChatState, ChatEvent>` is spelled out.** Every other file in this package imports `ChatTool` / `ChatAgent` / `ChatToolRegistry` / `ChatAgentRegistry` / `ChatGraph` from here. If you find yourself writing `Tool<ChatState, ChatEvent>` in `../adapter/` or `../runner/`, you are inlining what should be a one-line alias.
2. **`ChatState` is immutable.** Nodes return `Partial<ChatState>` updates; the executor merges them via `chatReducers`. Never mutate a state object you were handed.
3. **Append-by-default for lists.** `messages` and `pinnedCodocs` use the append reducer. If you are tempted to overwrite either of them, you are solving the wrong problem — introduce a trim / gc step elsewhere.
4. **Tools are identified by `string` in events**, not by `ToolId`. The tool id is opaque to the event stream; we carry it through as text so consumers outside the graph package don't need to know about the brand.
5. **No runtime logic beyond reducers.** If the thing you are adding has I/O, a prompt, or an LLM call, it belongs in a higher layer (`../adapter/`, `../runner/`, or outside this package entirely), not here.
