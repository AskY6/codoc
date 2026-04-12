# tools/

Concrete `ChatTool` implementations — the tool catalog available to chat agents.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package invariants.
Reads from: [`../state/`](../state/AGENTS.md) (for `ChatTool` alias), `@cobook/core`, `@cobook/graph`.
Must never import from: `../runner/`, `../adapter/`, `../agents/`.

## Why this subtree exists

`@cobook/graph` defines the generic `Tool<S, E>` contract. `../state/` binds it to `ChatTool = Tool<ChatState, ChatEvent>`. This directory owns the **concrete tool instances** — the things an agent can actually call during a chat turn.

Tools are pure w.r.t. state: they receive input + read-only state, execute side effects through closed-over deps, and return `Result<unknown, ToolError>`. They never mutate state directly; the agent node that invoked them decides what state update to apply.

## Modules

| File | What it owns |
|---|---|
| `platform.ts` | 6 workspace-level tools: `listCodocs`, `getCodoc`, `createCodoc`, `updateCodoc`, `deleteCodoc`, `getWorkspaceStatus`. Factory takes a `PlatformToolDeps` callback interface — the service layer supplies the implementations. |
| `rss.ts` | 2 RSS domain tools: `fetchRssFeed` (RSS parser), `fetchWebPage` (fetch + HTML strip). Self-contained — no service-layer deps. |

## Hard invariants

1. **Tools do not import from `../runner/` or `../agents/`.** They sit below both in the import graph. If a tool needs LLM access, that is a design error — tools are deterministic executors, not LLM wrappers.
2. **`PlatformToolDeps` is the DI seam.** Platform tools never import `@cobook/service` directly. The service layer constructs the deps and passes them in. This keeps `@cobook/chat` free of service-layer coupling.
3. **Tool schemas are Anthropic-shaped but vendor-neutral.** `inputSchema` is an opaque JSON Schema object forwarded verbatim to whatever LLM client the runner uses. No Anthropic SDK types leak into tool definitions.
