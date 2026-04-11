# tools/

The **tool contract** subtree. Defines what it means to be a runtime tool an agent can call during graph execution, plus the registry interface agents use to look tools up.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../graph/`](../graph/AGENTS.md), `@cobook/core` (`Result` only).
Must never import from: [`../agents/`](../agents/AGENTS.md). Tools do not call agents — delegation between agents is expressed in the graph topology, not inside a tool body.

## Modules

| File | What it owns |
|---|---|
| `ids.ts` | `ToolId` branded type |
| `tool.ts` | `ToolSchema`, `ToolError`, `Tool<S, E>` runtime interface |
| `registry.ts` | `ToolRegistry<S, E>` lookup surface |

## Hard invariants

1. **`Tool` is generic over `S` and `E`.** This subtree does **not** pick concrete state / event types. Applications (currently `@cobook/chat`) bind them via type aliases (`ChatTool = Tool<ChatState, ChatEvent>`). Do not reintroduce a default binding here — that was the pre-split design and it was explicitly reverted to match LangGraph / OpenAI Agents SDK / Mastra / Vercel AI SDK, where tool contracts are state-agnostic at the framework layer and bound at the application layer. The ergonomic "just write `ChatTool`" story belongs to the consumer package, not here.
2. **Tools do not mutate state.** They read the state argument and return `Result<output, ToolError>`. Any state delta is applied by the agent node that invoked the tool — tools only *produce output*, they never *commit state*.
3. **`input: unknown`.** Tools receive whatever the LLM produced. Each tool is responsible for parsing it against its own `schema.inputSchema`. We explicitly chose `unknown` over per-tool input generics to keep `ToolRegistry` homogeneous within a single `<S, E>` binding; revisit if a compelling type-safety case appears.
4. **Structured failures via `ToolError`.** Bad input and expected execution failures are `Result` variants. Unexpected errors (panics, network blowups) are allowed to throw and are caught by the executor.
5. **No reverse dependency on agents.** If a tool needs to "call another agent", model that as a conditional edge in the graph, not as a runtime import from `../agents/`.

## When adding a new built-in tool

Built-in tools are **not added to this package**. This subtree owns the **contract** only. Concrete built-in tools — the ones that actually read chat state, call APIs, touch a database — live in `@cobook/chat` (or higher) next to the application that cares about them. That way this package stays free of application concepts even when the tool catalogue grows.
