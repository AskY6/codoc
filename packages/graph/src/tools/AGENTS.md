# tools/

The **tool contract** subtree. Defines what it means to be a runtime tool an agent can call during graph execution, plus the registry interface agents use to look tools up.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../graph/`](../graph/AGENTS.md), [`../cobook/`](../cobook/AGENTS.md), `@cobook/core`.
Must never import from: [`../agents/`](../agents/AGENTS.md). Tools do not call agents — delegation between agents is expressed in the graph topology, not inside a tool body.

## Modules

| File | What it owns |
|---|---|
| `ids.ts` | `ToolId` branded type |
| `tool.ts` | `ToolSchema`, `ToolError`, `Tool` runtime interface |
| `registry.ts` | `ToolRegistry` lookup surface |

## Hard invariants

1. **Tools are bound to `CobookState`.** `Tool.execute` takes `CobookState`, not a generic `S`. Rationale: every tool in this package is used by cobook-bound agents, so forcing a generic parameter pollutes every consumer with a type variable that would always be `CobookState` in practice.
2. **Tools do not mutate state.** They read `CobookState` and return `Result<output, ToolError>`. Any state delta is applied by the agent node that invoked the tool — tools only *produce output*, they never *commit state*.
3. **`input: unknown`.** Tools receive whatever the LLM produced. Each tool is responsible for parsing it against its own `schema.inputSchema`. We explicitly chose `unknown` over per-tool input generics to keep `ToolRegistry` homogeneous; revisit if a compelling type-safety case appears.
4. **Structured failures via `ToolError`.** Bad input and expected execution failures are `Result` variants. Unexpected errors (panics, network blowups) are allowed to throw and are caught by the executor.
5. **No reverse dependency on agents.** If a tool needs to "call another agent", model that as a conditional edge in the graph, not as a runtime import from `../agents/`.

## When adding a new built-in tool

1. Create a folder `built-in/<tool-name>/` with a `schema.ts` and `execute.ts` split (keeps declarative and runtime halves obvious).
2. Keep the tool's state reads narrow — read only what the tool needs. Broad reads make future state-shape changes painful.
3. Return `Result` on structured failure, throw on truly unexpected failure. Do not swallow errors into a "success with empty output" shape.
