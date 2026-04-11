# agents/

The **runtime `Agent` interface** — the outermost subtree inside `@cobook/graph`. Everything else in the package exists so that `Agent` can be defined cleanly.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../graph/`](../graph/AGENTS.md), [`../tools/`](../tools/AGENTS.md), `@cobook/core` (`AgentId` only).
Must never import from: nothing (this is the outermost subtree).

## Modules

| File | What it owns |
|---|---|
| `ids.ts` | `ModelId` branded type |
| `agent.ts` | Runtime `Agent<S, E>` interface — a `GraphNode<S, E, AgentId>` specialization |
| `registry.ts` | `AgentRegistry<S, E>` lookup surface |

## What `Agent` is — and is not

**Is:** a runtime object that plugs into the graph executor. An LLM-driven `GraphNode<S, E, AgentId>` with a system prompt, a bound model, and a closed set of tools. The `S` / `E` parameters are left open so the same interface works regardless of which application is wiring up the graph; `@cobook/chat` binds them to `ChatState` / `ChatEvent` through a `ChatAgent` alias.

**Is not:** the persisted "here is an agent that exists" record. That is `AgentListing` in `@cobook/core/src/cobook/agent.ts`, and it is intentionally starved of behaviour. A higher layer (chat runner, service layer) takes an `AgentListing`, resolves it through an `AgentRegistry<S, E>`, and gets back an `Agent` that can actually run.

This split is load-bearing. Do not:
- import `AgentListing` here and conflate the two — `Agent` does not extend `AgentListing`; they overlap structurally on `id / name / description` but serve different contracts
- add `systemPrompt` / `tools` / `model` fields to `AgentListing` in core — runtime concerns stay out of the storage-bound record
- export `Agent` from `@cobook/core` — core is runtime-free

## Hard invariants

1. **`Agent` uses `AgentId` as its `GraphNode.id`.** This is the whole reason `GraphNode` has a third generic slot: so Agents carry their own brand into the graph without casting. `AgentId` is the **only** core-originating type allowed in this subtree.
2. **`Agent` is generic over `S` and `E`.** Same rationale as `Tool<S, E>` — tool/agent contracts are state-agnostic at the framework layer (LangGraph, OpenAI Agents SDK, Mastra, Vercel AI SDK all work this way) and bound at the application layer via a type alias.
3. **Tools are bound at construction time.** An agent's `tools: readonly Tool<S, E>[]` array is immutable. Adding a tool to an existing agent means building a new instance.
4. **No reverse dependency on higher layers.** This subtree is the package's outermost layer; nothing in `@cobook/graph` imports from it. Consumers live in `@cobook/chat` and above.
5. **No LLM client interface here.** `model: ModelId` is opaque. The mapping `ModelId → LLM client` belongs one layer up; keeping it out of this package means we can swap vendors without touching agent definitions.

## Typical built-in agents (future)

Concrete built-in agents — the ones that actually carry system prompts, pick models, and wire tools — do **not** live in this package. They live in `@cobook/chat` (or higher) alongside the application that ships them. This subtree only owns the *shape* of an Agent. When built-ins land downstream, they should fall into one of two shapes to match the router / specialist invariant documented in `@cobook/core/src/cobook/AGENTS.md`:

- **Router**: `tools: []`, `systemPrompt` describes routing policy, `run` inspects state and returns `{ activeAgent: <next> }`. Does not call the LLM for tool use.
- **Specialist**: `tools: [...]`, `run` calls the LLM with `systemPrompt` + `state.messages`, executes tool calls against the bound registry, appends the assistant message to `state.messages`.

Mixing the two shapes in one agent is a smell. If a router needs to "do work", it should hand off to a specialist, not grow a tool list.
