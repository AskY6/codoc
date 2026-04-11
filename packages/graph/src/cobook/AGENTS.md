# cobook/

The **graph → cobook** bridge. This is where the generic mini-langgraph in `../graph/` meets cobook-flavoured domain concepts (`WorkspaceId`, `ThreadId`, `AgentId`, `CodocId`, `ChatMessage`).

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../graph/`](../graph/AGENTS.md), `@cobook/core` (cobook ids + ChatMessage).
Must never import from: [`../tools/`](../tools/AGENTS.md), [`../agents/`](../agents/AGENTS.md). Both of those live *above* `cobook/` in the import direction.

## Why this subtree exists

`../graph/` is intentionally generic — it knows nothing about workspaces, messages, or codocs. Without this subtree, a consumer would need to pick its own `S` and `E` every time it built a graph. `cobook/` picks them once, names them (`CobookState`, `CobookEvent`), and provides the canonical reducer table so that every agent / tool in this package can assume the same shape.

## Modules

| File | What it owns |
|---|---|
| `state.ts` | `CobookState` — the state flowing through a cobook run |
| `events.ts` | `CobookEvent` discriminated union streamed out of the executor |
| `reducers.ts` | `cobookReducers` — the canonical `StateReducers<CobookState>` table |

## Hard invariants

1. **This is the *only* subtree in the package where cobook domain ids may be imported.** `../graph/` stays generic; `../tools/` and `../agents/` import their shared state and event types from here and do not rename them.
2. **Tools are identified by `string` in events**, not by the `ToolId` brand defined in `../tools/`. See the design note in `events.ts`. This keeps `tools → cobook` a strict one-way dependency.
3. **`CobookState` is immutable.** Nodes return `Partial<CobookState>` updates; the executor merges them via `cobookReducers`. Never mutate a state object you were handed.
4. **Append-by-default for lists.** `messages` and `pinnedCodocs` use the append reducer. If you are tempted to overwrite either of them, you are solving the wrong problem — introduce a trim / gc step elsewhere.
5. **No runtime logic beyond reducers.** If the thing you are adding has I/O, a prompt, or an LLM call, it belongs in `../agents/` or `../tools/`, not here.

## Planned future move

This subtree is expected to leave `@cobook/graph` eventually — either as its own package or folded into `@cobook/chat`. The contract here is intentionally narrow so that the move is a file relocation, not a rewrite.
