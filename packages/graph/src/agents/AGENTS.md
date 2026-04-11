# agents/

The **runtime `Agent` interface** — the outermost subtree inside `@cobook/graph`. Everything else in the package exists so that `Agent` can be defined cleanly.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../graph/`](../graph/AGENTS.md), [`../cobook/`](../cobook/AGENTS.md), [`../tools/`](../tools/AGENTS.md), `@cobook/core` (`AgentId` only).
Must never import from: nothing (this is the outermost subtree).

## Modules

| File | What it owns |
|---|---|
| `ids.ts` | `ModelId` branded type |
| `agent.ts` | Runtime `Agent` interface — a `GraphNode` specialization |
| `registry.ts` | `AgentRegistry` lookup surface |

## What `Agent` is — and is not

**Is:** a runtime object that plugs into the graph executor. An LLM-driven `GraphNode<CobookState, CobookEvent, AgentId>` with a system prompt, a bound model, and a closed set of tools.

**Is not:** the persisted "here is an agent that exists" record. That is `AgentListing` in `@cobook/core/src/cobook/agent.ts`, and it is intentionally starved of behaviour. A higher layer (chat runner, service layer) takes an `AgentListing`, resolves it through an `AgentRegistry`, and gets back an `Agent` that can actually run.

This split is load-bearing. Do not:
- import `AgentListing` here and conflate the two — `Agent` does not extend `AgentListing`; they overlap structurally on `id / name / description` but serve different contracts
- add `systemPrompt` / `tools` / `model` fields to `AgentListing` in core — runtime concerns stay out of the storage-bound record
- export `Agent` from `@cobook/core` — core is runtime-free

## Hard invariants

1. **`Agent` uses `AgentId` as its `GraphNode.id`.** This is the whole reason `GraphNode` has a third generic slot: so Agents carry their own brand into the graph without casting.
2. **Tools are bound at construction time.** An agent's `tools` array is immutable. Adding a tool to an existing agent means building a new instance.
3. **No reverse dependency on higher layers.** This subtree is the package's outermost layer; nothing in `@cobook/graph` imports from it. Consumers live in `@cobook/chat` and above.
4. **No LLM client interface here.** `model: ModelId` is opaque. The mapping `ModelId → LLM client` belongs one layer up; keeping it out of this package means we can swap vendors without touching agent definitions.

## Typical built-in agents (future)

When built-ins land under `built-in/`, they should fall into one of two shapes to match the router / specialist invariant already documented in `@cobook/core/src/cobook/AGENTS.md`:

- **Router**: `tools: []`, `systemPrompt` describes routing policy, `run` inspects state and returns `{ activeAgent: <next> }`. Does not call the LLM for tool use.
- **Specialist**: `tools: [...]`, `run` calls the LLM with `systemPrompt` + `state.messages`, executes tool calls against the bound registry, appends the assistant message to `state.messages`.

Mixing the two shapes in one agent is a smell. If a router needs to "do work", it should hand off to a specialist, not grow a tool list.
