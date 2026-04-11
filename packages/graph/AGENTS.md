# @cobook/graph

A small, application-free graph-based agent runtime. Think of it as a minimal `langgraph`: nodes transform state, edges decide the next node, an executor runs the whole thing end-to-end and streams events out.

This package owns **runtime contracts** for agents and tools, all **generic over state `S` and event `E`**. It contains **no application concepts**. `ChatState`, `ChatEvent`, the canonical reducer table, and the `ChatTool` / `ChatAgent` / `ChatGraph` type aliases live in `@cobook/chat`.

The declarative "an agent exists in this workspace" record lives in `@cobook/core` as `AgentListing` and is not re-exported from here.

This is the **root node** of a tree-based context layout. Each subtree has its own `AGENTS.md` — read only the ones relevant to your task.

## Subtree index

| Path | Responsibility | Depends on |
|---|---|---|
| [`src/graph/AGENTS.md`](src/graph/AGENTS.md) | Pure mini-langgraph: `GraphNode`, `Edge`, `Graph`, `runGraph`. Generic over `S`, `E`. **Nothing cobook-flavoured.** | `@cobook/core` (`Brand`, `Result` only) |
| [`src/tools/AGENTS.md`](src/tools/AGENTS.md) | `Tool<S, E>` contract, `ToolRegistry<S, E>`. Generic. | `graph`, `@cobook/core` |
| [`src/agents/AGENTS.md`](src/agents/AGENTS.md) | `Agent<S, E>` runtime interface (LLM-driven `GraphNode` branded by `AgentId`), `AgentRegistry<S, E>` | `graph`, `tools`, `@cobook/core` (`AgentId` only) |

## Cross-module invariants

These apply to **every** subtree. They are not repeated inside subtree docs.

### 1. Import direction is strictly inward

```
agents → tools → graph
graph  → (nothing inside this package)
```

No sibling ever skips a layer or reaches sideways. `graph/` must not know that `tools/` or `agents/` exist; `tools/` must not import `agents/` (no "ask-another-agent" meta tools at this stage).

### 2. This package is application-free

The only types this package may import from `@cobook/core` are:
- `Brand`, `Result` (generic utilities), and
- `AgentId` (used **only** inside `src/agents/` as the branded node id for `Agent`).

`WorkspaceId`, `ThreadId`, `CodocId`, `ChatMessage`, `ChatState`, `ChatEvent` — none of these may appear anywhere in `src/`. If you feel the urge, the code belongs in `@cobook/chat`, not here.

### 3. `graph/` is pure mini-langgraph

`graph/` is generic over state `S` and event `E`. It **must not** mention `AgentId` or anything else that hints at a concrete application. Its only `@cobook/core` dependencies are `Brand` and `Result`.

### 4. `tools/` and `agents/` are generic contract layers

`Tool<S, E>` and `Agent<S, E>` are parametric. This package does **not** pick concrete `S` / `E`. Downstream consumers (currently `@cobook/chat`) bind them via type aliases:

```ts
// inside @cobook/chat
export type ChatTool = Tool<ChatState, ChatEvent>;
export type ChatAgent = Agent<ChatState, ChatEvent>;
```

Do not reintroduce a "default state shape" here for ergonomics — that was the pre-split design and it was explicitly reverted to match how mature agent frameworks (LangGraph, OpenAI Agents SDK, Mastra, Vercel AI SDK) scope their tool/agent contracts.

### 5. `tools/` is below `agents/`

Agents compose tools; tools never compose agents. If a tool needs to delegate to another agent, the delegation belongs in the graph topology (a conditional edge to an agent node), not inside the tool.

### 6. `Agent` runtime interface is defined in this package, not in core

`@cobook/core` only holds `AgentListing` (id + name + description). The runtime interface that plugs into the executor, owns a system prompt, a model id, and a tool list lives in [`src/agents/agent.ts`](src/agents/agent.ts). Do not add runtime fields to `AgentListing`.

### 7. Pure functions return `Result<T, E>`

Same rule as `@cobook/core`. The executor can propagate IO errors from node/tool implementations, but all structured failures must be `Result` variants.

## Public entry point

`src/index.ts` re-exports the types needed to **consume** the runtime from outside (primarily from `@cobook/chat`). Internal skeleton helpers stay unexported.

## Current status: skeleton only

Function bodies throw `not implemented`. Only type signatures and `AGENTS.md` contracts are meaningful right now. See the root `DESIGN.md` / session notes for the planned fill-in order.

## Planned next-session tweak

Drop `E` from the `Tool<S, E>` signature — mature frameworks inject event writers via the runtime context rather than threading them through every tool type. After the change `Tool<S>` will read `state: S` and emit via `NodeContext` whose `E` is bound by the executor at call time. This is intentionally deferred so the current skeleton can land first.
