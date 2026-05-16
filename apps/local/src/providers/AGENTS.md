# providers/

Parent: `apps/local/src/`
Reads from: `../workspace/index.js`, `../server/mcp.js`, `../server/chat-meta.js`
Must never import from: `@cobook/service`, `@cobook/storage`, `@cobook/chat`, `@cobook/graph`, `ui/`

## Purpose

Adapter layer that abstracts CLI chat backends behind a unified `ChatProvider` interface.
Each provider translates a specific CLI's protocol into the common `ChatEvent` SSE envelope.

## Key files

- `types.ts` — `ChatProvider` interface, `ChatEvent` union, `ProviderInfo`
- `registry.ts` — Startup detection and lookup; probes all providers in parallel via `detect()`
- `claude-code.ts` — Adapter for Claude Code via `@anthropic-ai/claude-agent-sdk`
- `codex.ts` — Adapter for OpenAI Codex CLI via `codex exec --json` subprocess
- `kiro.ts` — Adapter for Kiro CLI via `kiro-cli acp` subprocess (ACP / JSON-RPC 2.0)

## Contracts

- Every adapter must implement `ChatProvider` from `types.ts`
- `detect()` must be non-throwing and return `false` if the binary is absent
- `chat()` yields `ChatEvent` — the first event should be `{ kind: "init", sessionId }` 
- `readHistory()` reads the CLI's native session storage and returns `SessionMessage[]`
- New providers are registered in `registry.ts` → `ALL_PROVIDERS` array

## Adding a new provider

1. Create `<name>.ts` implementing `ChatProvider`
2. Add to `ALL_PROVIDERS` in `registry.ts`
3. No other files need to change — the registry auto-discovers and the UI auto-renders
