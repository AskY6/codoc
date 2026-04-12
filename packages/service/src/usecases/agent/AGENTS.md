# usecases / agent

Agent-related business actions: listing, linking, and running agent turns.

Parent: [`../AGENTS.md`](../AGENTS.md) — use case shape, transaction rules, error union rules.
Reads from: `../../repo/` (agent, workspace-agent, thread-agent, thread-codoc, thread, codoc), `@cobook/chat`, `@cobook/graph`, `@cobook/core`.
Must never import from: `../workspace/`, `../codoc/`, `../thread/` (sibling aggregates — use repo layer instead).

## Modules

| File | What it owns |
|---|---|
| `list-agents.ts` | `listAgents` — pass-through to `agentRepo.list`. |
| `list-workspace-agents.ts` | `listWorkspaceAgents` — return agent ids linked to a workspace. |
| `set-workspace-agents.ts` | `setWorkspaceAgents` — reconcile desired vs. current agent set for a workspace. Transactional diff (read → link new → unlink removed). |
| `set-thread-agents.ts` | `setThreadAgents` — same diff pattern, scoped to a thread. |
| `set-thread-codocs.ts` | `setThreadCodocs` — same diff pattern for codoc links; error includes `ThreadCodocWorkspaceMismatch`. |
| `run-agent-turn.ts` | `runAgentTurn` — the composite use case that drives a full agent turn: read thread → persist user msg → build graph (router + specialists) → run turn via `@cobook/chat` → persist assistant msgs. Accepts optional `llmClient` for test DI. |

## `runAgentTurn` specifics

This is the largest use case in the codebase. Key design decisions:

1. **Graph is built per-turn.** The graph topology depends on which agents are linked to the thread, so it cannot be cached statically. `buildGraph` validates on every call.
2. **Platform tool deps close over `ServiceCtx`.** The use case constructs a `PlatformToolDeps` object whose methods call repo/use-case functions with the current ctx. This keeps `@cobook/chat` tools free of service-layer imports.
3. **Dynamic imports for codoc use cases.** `createCodoc`, `updateCodocContent`, and `deleteCodoc` are dynamically imported inside the tool deps to avoid circular dependency between agent and codoc use case barrels.
4. **Optional `llmClient` on input.** Tests inject a mock `LlmClient` to exercise the full flow without hitting the Anthropic API. Production uses `createAnthropicLlmClient` from `@cobook/chat`.
5. **No transaction wrapping the LLM call.** The LLM round-trip can take seconds; holding a DB transaction across it would be problematic. Reads and writes are sequential but not atomic. For in-memory storage this is fine; a future slice may add compensating logic.
