# @cobook/graph

A small, cobook-tailored graph-based agent runtime. Think of it as a minimal `langgraph`: nodes transform state, edges decide the next node, an executor runs the whole thing end-to-end and streams events out.

This package owns **runtime contracts** for agents and tools. The declarative "an agent exists in this workspace" record lives in `@cobook/core` as `AgentListing` and is not re-exported from here.

This is the **root node** of a tree-based context layout. Each subtree has its own `AGENTS.md` — read only the ones relevant to your task.

## Subtree index

| Path | Responsibility | Depends on |
|---|---|---|
| [`src/graph/AGENTS.md`](src/graph/AGENTS.md) | Pure mini-langgraph: `GraphNode`, `Edge`, `Graph`, `runGraph`. Generic over `S`, `E`. **Zero cobook concepts.** | `@cobook/core` (types only) |
| [`src/cobook/AGENTS.md`](src/cobook/AGENTS.md) | `CobookState`, `CobookEvent` — the specialization that binds the graph to cobook-flavoured state | `graph`, `@cobook/core` |
| [`src/tools/AGENTS.md`](src/tools/AGENTS.md) | `Tool<S>` contract, `ToolRegistry`, built-in tools | `graph`, `cobook`, `@cobook/core` |
| [`src/agents/AGENTS.md`](src/agents/AGENTS.md) | Runtime `Agent` interface — an LLM-driven `GraphNode`. `AgentRegistry`. Built-in agents | `graph`, `cobook`, `tools`, `@cobook/core` |

## Cross-module invariants

These apply to **every** subtree. They are not repeated inside subtree docs.

### 1. Import direction is strictly inward

```
agents → tools → cobook → graph
graph  → (nothing inside this package)
```

No sibling ever skips a layer or reaches sideways. `graph/` must not know `cobook/` exists; `tools/` must not import `agents/` (no "ask-another-agent" meta tools at this stage).

### 2. `graph/` is pure mini-langgraph

`graph/` is generic over state `S` and event `E`. It **must not** mention `CobookState`, `CobookEvent`, `WorkspaceId`, `AgentId`, `ChatMessage`, `CodocId`, or any other cobook concept. The whole point is that `graph/` could in principle be used for a non-cobook application.

### 3. `cobook/` is where cobook concepts enter

This is the only subtree allowed to import cobook domain ids (`WorkspaceId`, `ThreadId`, `AgentId`, `CodocId`) and `ChatMessage` from `@cobook/core`. Downstream subtrees assume `S extends CobookState` and consume this layer's types directly; they do not reach back to generic `graph/`.

### 4. `tools/` is below `agents/`

Agents compose tools; tools never compose agents. If a tool needs to delegate to another agent, the delegation belongs in the graph topology (a conditional edge to an agent node), not inside the tool.

### 5. `Agent` runtime interface is defined in this package, not in core

`@cobook/core` only holds `AgentListing` (id + name + description). The runtime interface that plugs into the executor, owns a system prompt, a model id, and a tool list lives in [`src/agents/agent.ts`](src/agents/agent.ts). Do not add runtime fields to `AgentListing`.

### 6. Pure functions return `Result<T, E>`

Same rule as `@cobook/core`. The executor can propagate IO errors from node/tool implementations, but all structured failures must be `Result` variants.

## Public entry point

`src/index.ts` re-exports the types needed to **consume** the runtime from outside (e.g. from `@cobook/chat`). Internal skeleton helpers stay unexported.

## Current status: skeleton only

Function bodies throw `not implemented`. Only type signatures and `AGENTS.md` contracts are meaningful right now. See the root `DESIGN.md` / session notes for the planned fill-in order.

## Planned future split

`src/cobook/` is expected to move out into its own package (tentatively `@cobook/graph-cobook` or folded into `@cobook/chat`) once the dependency boundaries between "pure graph" and "cobook-bound graph" stabilize. Do not deepen `cobook/`'s coupling with `graph/` beyond what the current interface requires.
