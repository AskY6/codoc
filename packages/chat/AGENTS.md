# @cobook/chat

The **chat runtime** for cobook: takes the generic mini-langgraph in `@cobook/graph` and binds it to a chat-turn state shape (`ChatState`), a chat-turn event union (`ChatEvent`), and the `ChatMessage` ADT from `@cobook/core`. Consumers of this package (a service layer, a server, a CLI) drive chat turns end-to-end through the runner and hand resulting events / messages back to their UI or persistence layer.

Dependency shape: `@cobook/chat → @cobook/graph → @cobook/core`. Nothing in `@cobook/graph` or `@cobook/core` may import from here.

This is the **root node** of a tree-based context layout. Each subtree has its own `AGENTS.md` — read only the ones relevant to your task.

## Subtree index

| Path | Responsibility | Depends on |
|---|---|---|
| [`src/state/AGENTS.md`](src/state/AGENTS.md) | `ChatState`, `ChatEvent`, `chatReducers`, and the `ChatTool` / `ChatAgent` / `ChatToolRegistry` / `ChatAgentRegistry` / `ChatGraph` aliases | `@cobook/graph`, `@cobook/core` |
| [`src/adapter/AGENTS.md`](src/adapter/AGENTS.md) | Translation between `ChatMessage[]` in core and `ChatState` / `ChatEvent` flowing through the graph | `state`, `@cobook/graph`, `@cobook/core` |
| [`src/runner/AGENTS.md`](src/runner/AGENTS.md) | Chat turn runner — seeds initial state, invokes `runGraph`, collects events, returns the outcome | `adapter`, `state`, `@cobook/graph`, `@cobook/core` |

## Cross-module invariants

These apply to **every** subtree. They are not repeated inside subtree docs.

### 1. Import direction is strictly inward

```
runner → adapter → state → @cobook/graph
                        \→ @cobook/core
```

`state/` is the **only** subtree allowed to touch `@cobook/graph`'s generic `Tool` / `Agent` types directly — everyone else reads `ChatTool` / `ChatAgent` / `ChatGraph` through `state/`'s aliases so the concrete `<S, E>` binding is stated exactly once in this package.

### 2. This is the chat boundary

This package owns chat-turn concepts: `ChatState`, `ChatEvent`, `ChatMessage` flow. If a file mentions `WorkspaceId`, `ThreadId`, `CodocId`, `AgentId`, or `ChatMessage`, that is expected. If a file in `@cobook/graph` mentions any of those, that is a bug — push the concept down here.

### 3. `Agent` runtime interface stays in `@cobook/graph`

The **generic** `Agent<S, E>` interface lives in `@cobook/graph/agents`. This package binds it (`ChatAgent = Agent<ChatState, ChatEvent>`) but does **not** redefine it. If you feel the urge to declare a new `Agent`-shaped interface inside this package, you are re-opening a settled design decision — don't.

### 4. `ChatMessage` in, `ChatEvent` out

The runner's job at a high level: consume a `ChatMessage[]` (the thread so far), seed a `ChatState`, run the graph, stream `ChatEvent`s to the caller, and return the final state. `ChatMessage` is the persistence-facing shape; `ChatEvent` is the streaming-facing shape. The adapter owns the translation between them.

### 5. Pure functions return `Result<T, E>`

Same rule as `@cobook/core` and `@cobook/graph`. Structured failures (bad state seed, graph topology rejection, tool error surfaced to the user) are ADT variants, not exceptions.

## Public entry point

`src/index.ts` re-exports the types needed to consume the runtime from outside (a service layer, tests, a CLI). Internal helpers stay unexported.

## Current status: skeleton only

Function bodies are `declare`-only. The file layout, module index, and `AGENTS.md` contracts are the meaningful output at this stage. See session notes for the planned fill-in order.

## Planned next-session work

- Drop `E` from `Tool<S, E>` (and therefore from `ChatTool`) once `@cobook/graph` reworks its tool contract to inject the event writer through `NodeContext` rather than the type signature. That change lives in `@cobook/graph`; this package will absorb it by updating the alias.
- Flesh out `runner/` and `adapter/` contracts beyond the placeholder signatures in this session.
