# Slice 5 Implementation Plan: Agent Activation + Agent Turn

## Architecture Decisions (frozen)

1. **Router topology: two-step structured output** — Router is a pure Haiku classifier (structured output, no user-facing text). "General assistant" is a separate specialist node (fallback route). Each specialist is its own agent node.
2. **LLM client injection: NodeContext** — `@cobook/graph`'s `NodeContext<E>` stays untouched. `@cobook/chat` defines `ChatRunContext extends NodeContext<ChatEvent>` with `llm: LlmClient`. Agent instances are pure data; runner constructs `ChatRunContext` and passes it through `runGraph`.
3. **pinnedCodocs content: tool-based reads** — Agents read codoc content via `getCodoc` tool call, not pre-seeded messages. `ChatState.pinnedCodocs` stays `readonly CodocId[]`.
4. **First catalog** — Platform tools: listCodocs, getCodoc, createCodoc, updateCodoc, deleteCodoc, getWorkspaceStatus. RSS tools: fetchRssFeed, fetchWebPage. Agents: Router + General assistant + RSS specialist.
5. **Registry: TS modules** — Map-based implementations of `ChatAgentRegistry` / `ChatToolRegistry`.
6. **Router is LLM-driven** — Haiku structured-output classification, not rule-based.

## `runGraph` signature change

The current skeleton has `runGraph(graph, initialState, onEvent, options?)`. Change to:

```ts
function runGraph<S, E>(
  graph: Graph<S, E>,
  initialState: S,
  ctx: NodeContext<E>,   // caller provides full context
  options?: ExecutorOptions,
): Promise<Result<ExecutionResult<S>, RunGraphError>>;
```

`runChatTurn` constructs `ChatRunContext` (which extends `NodeContext<ChatEvent>` with `llm`) and passes it in. `@cobook/graph` only sees `NodeContext<E>` (structural typing). Agent `run(state, ctx)` casts to `ChatRunContext` to access `llm`.

## 5a / 5b split

- **5a**: Static activation (stores, CRUD, repos) + synchronous agent turn (graph runtime, LLM calling, tool execution, message persistence — HTTP returns JSON, not SSE)
- **5b**: SSE streaming transport + reconnect + auto-title

---

## Phase 1: Storage Layer (5 stores)

### Step 1.1: Add `agentId()` and `sessionId()` to `IdGenerator`

**Packages:** `@cobook/service` (port), `apps/server` (UuidIdGenerator), `@cobook/service/__tests__` (counterIdGenerator)

- Add `agentId(): AgentId` and `sessionId(): SessionId` to the `IdGenerator` interface
- Implement in `UuidIdGenerator` (`crypto.randomUUID()` cast to branded type)
- Implement in test helper's `counterIdGenerator` (`agent_1`, `session_1`)

### Step 1.2: Implement all five memory stores

**Package:** `@cobook/storage-memory`

Each follows the `MemoryThreadStore` pattern.

#### 1.2a: `createMemoryAgentStore`

**File:** `packages/storage-memory/src/stores/agent.ts` (new)

- `Map<AgentId, StoredAgent>` backing store
- `get/list/create/update/delete`; `update` enforces `expectedRev`
- Global resource — no workspace ownership, no cascade hook

#### 1.2b: `createMemoryWorkspaceAgentStore`

**File:** `packages/storage-memory/src/stores/workspace-agent.ts` (new)

- `Map<string, StoredWorkspaceAgent>` keyed by `${workspaceId}:${agentId}`
- `link` is idempotent; validates workspace + agent existence via dep callbacks
- `unlink` is idempotent
- `listByWorkspace` / `listByAgent`: iterate and filter
- `__cascadeDeleteByWorkspace` hook

#### 1.2c: `createMemoryThreadAgentStore`

**File:** `packages/storage-memory/src/stores/thread-agent.ts` (new)

- `Map<string, StoredThreadAgent>` keyed by `${threadId}:${agentId}`
- `link` validates thread + agent existence; idempotent
- `listByThread` / `listByAgent`
- `__cascadeDeleteByWorkspace` + `__cascadeDeleteByThread` hooks

#### 1.2d: `createMemoryThreadCodocStore`

**File:** `packages/storage-memory/src/stores/thread-codoc.ts` (new)

- `Map<string, StoredThreadCodoc>` keyed by `${threadId}:${codocId}`
- `link` enforces **same-workspace constraint** (thread's workspaceId must match codoc's workspaceId)
- `listByThread` / `listByCodoc`
- `__cascadeDeleteByWorkspace` + `__cascadeDeleteByThread` hooks
- Once live, `CodocStore.delete` must check `listByCodoc` for referrers → return `CodocReferenced`

#### 1.2e: `createMemoryAgentSessionStore`

**File:** `packages/storage-memory/src/stores/session.ts` (new)

- `Map<SessionId, StoredAgentSession>` backing store
- `get/create/update/delete`; `update` enforces `expectedRev`
- `__cascadeDeleteByWorkspace` hook

#### 1.2f: Wire all stores into `createMemoryStorage`

**File:** `packages/storage-memory/src/storage.ts`

- Replace 5 stubs with real stores
- Wire cross-store callbacks: `workspaceExists`, `agentExists`, `getThreadWorkspaceId`, `getCodocWorkspaceId`
- Extend workspace delete cascade: now also cascades into workspaceAgents, threadAgents, threadCodocs, sessions
- Extend thread delete cascade: now also cascades into threadAgents, threadCodocs
- Wire `CodocStore.delete` referrer check via `threadCodocs.listByCodoc`
- Remove/empty `stubs.ts`

**Testable:** Typecheck passes across all 14 packages.

---

## Phase 2: Service Layer — Repos + CRUD Use Cases

### Step 2.1: Add `agentRepo`

**File:** `packages/service/src/repo/agent.ts` (new)

- Thin facade over `Storage.agents`
- `get(ctx, id) -> Result<AgentListItem, AgentNotFound>`
- `list(ctx) -> readonly AgentListItem[]`

**DTO:** `AgentListItem` in `packages/service/src/types/agent.ts` (new):

```ts
interface AgentListItem {
  readonly listing: AgentListing;  // nests core type (canonical pattern)
  readonly createdAt: number;
}
```

### Step 2.2: Add `workspaceAgentRepo`

**File:** `packages/service/src/repo/workspace-agent.ts` (new)

- `link(ctx, link) -> Result<void, WorkspaceNotFound | AgentNotFound>`
- `unlink(ctx, link) -> void` (idempotent)
- `listByWorkspace(ctx, workspaceId) -> readonly AgentId[]`
- `countByWorkspace(ctx, workspaceId) -> number` (for workspace list badge)

### Step 2.3: Add `threadAgentRepo`

**File:** `packages/service/src/repo/thread-agent.ts` (new)

- `link/unlink/listByThread` — same shape as workspaceAgentRepo

### Step 2.4: Add `threadCodocRepo`

**File:** `packages/service/src/repo/thread-codoc.ts` (new)

- `link` error union includes `ThreadCodocWorkspaceMismatch`
- `unlink/listByThread`

### Step 2.5: Export new repos from `packages/service/src/repo/index.ts`

### Step 2.6: CRUD use cases

All follow the existing one-file-per-action pattern.

#### `listAgents`
- `packages/service/src/usecases/agent/list-agents.ts`
- Pass-through to `agentRepo.list`

#### `setWorkspaceAgents`
- `packages/service/src/usecases/agent/set-workspace-agents.ts`
- Input: `{ workspaceId, agentIds }`
- Logic: `withTransaction` → read current → diff (toLink/toUnlink) → link/unlink each
- Error: `WorkspaceNotFound | AgentNotFound`

#### `setThreadAgents`
- `packages/service/src/usecases/agent/set-thread-agents.ts`
- Same diff pattern, scoped to threadId

#### `setThreadCodocs`
- `packages/service/src/usecases/agent/set-thread-codocs.ts`
- Same diff pattern; error includes `ThreadCodocWorkspaceMismatch`

### Step 2.7: Add `agentCount` to `WorkspaceListItem`

- `packages/service/src/types/workspace.ts` — add `agentCount: number`
- `packages/service/src/repo/workspace.ts` — `toListItem` calls `workspaceAgentRepo.countByWorkspace`
- `apps/web/src/types.ts` — add to wire type
- `apps/web/src/pages/workspace-list.tsx` — display badge (mirrors codocCount)

### Step 2.8: Extend `ThreadDetail`

- `packages/service/src/types/thread.ts` — add `agentIds: readonly string[]`, `codocIds: readonly string[]`
- `packages/service/src/usecases/thread/get-thread.ts` — also fetch from threadAgentRepo + threadCodocRepo

### Step 2.9: Export new use cases + types from package indexes

**Testable:** Use case tests for all 4 CRUD use cases + cascade on workspace delete.

---

## Phase 3: Graph + Chat Runtime (fill skeletons)

### Step 3.1: `mergeState` in `@cobook/graph`

**File:** `packages/graph/src/graph/state.ts`

Iterate `Partial<S>` keys, apply reducer if present, otherwise last-write-wins.

**Testable:** Unit tests with append + last-write-wins reducers.

### Step 3.2: `buildGraph` in `@cobook/graph`

**File:** `packages/graph/src/graph/graph.ts`

Validate: no duplicate node ids, entry exists, all edge refs exist, reachability, cycle detection (DFS back-edge).

**Testable:** Unit tests for valid graph, duplicates, unknown edges, cycles.

### Step 3.3: `runGraph` in `@cobook/graph`

**File:** `packages/graph/src/graph/executor.ts`

**Signature change:**

```ts
export function runGraph<S, E>(
  graph: Graph<S, E>,
  initialState: S,
  ctx: NodeContext<E>,        // was: onEvent callback
  options?: ExecutorOptions,
): Promise<Result<ExecutionResult<S>, RunGraphError>>;
```

Main loop:
1. Start at `graph.entry`, steps = 0
2. If `currentNode === END` → success `reachedEnd: true`
3. If `steps >= maxSteps` → `maxStepsExceeded`
4. If `signal.aborted` → `aborted`
5. `node.run(state, ctx)` — on throw → `nodeThrew`
6. `mergeState(state, partial, graph.reducers)`
7. Resolve edge (static → `edge.to`; conditional → evaluate branches) — no match → `noMatchingBranch`
8. Next node, steps++
9. Default `maxSteps`: 50

**Testable:** Unit tests — static edges, conditional edges, maxSteps, abort, nodeThrew.

### Step 3.4: `chatReducers` in `@cobook/chat`

**File:** `packages/chat/src/state/reducers.ts`

```ts
messages: (prev, incoming) => [...prev, ...incoming],
pinnedCodocs: (prev, incoming) => [...prev, ...incoming],
// all other fields: last-write-wins (no reducer needed)
```

### Step 3.5: `buildInitialState` in `@cobook/chat`

**File:** `packages/chat/src/adapter/adapter.ts`

Pure construction — spread params into `ChatState` object.

### Step 3.6: `eventsToAssistantMessages` in `@cobook/chat`

**File:** `packages/chat/src/adapter/adapter.ts`

Filter events for `kind === "done"`, return their `finalMessage` fields. Token deltas and tool calls are transient streaming artifacts.

### Step 3.7: `runChatTurn` in `@cobook/chat`

**File:** `packages/chat/src/runner/runner.ts`

```ts
export async function runChatTurn(
  graph: ChatGraph,
  initialState: ChatState,
  ctx: ChatRunContext,       // extends NodeContext<ChatEvent> with llm
  signal?: AbortSignal,
): Promise<Result<ExecutionResult<ChatState>, RunGraphError>> {
  return runGraph(graph, initialState, ctx, { maxSteps: 50, signal });
}
```

**Testable:** Integration test — build simple graph, run turn, collect events.

---

## Phase 4: Agent + Tool Definitions (Application Layer)

### Step 4.1: `LlmClient` interface + `ChatRunContext`

**File:** `packages/chat/src/runner/context.ts` (new)

```ts
export interface LlmClient {
  createMessage(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: readonly LlmMessage[];
    tools?: readonly LlmToolDef[];
  }): Promise<LlmResponse>;
}

export interface ChatRunContext extends NodeContext<ChatEvent> {
  readonly llm: LlmClient;
}
```

Define `LlmMessage`, `LlmToolDef`, `LlmResponse` as minimal Anthropic-shaped types **without** importing `@anthropic-ai/sdk`. Keeps `@cobook/chat` vendor-neutral.

### Step 4.2: Anthropic LLM adapter

**File:** `packages/chat/src/runner/llm-adapter.ts` (new)

- `createAnthropicLlmClient(config: { apiKey?, baseURL? }): LlmClient`
- **Only file in the new stack that imports `@anthropic-ai/sdk`**
- Maps `LlmClient` calls to Anthropic API calls

### Step 4.3: Platform tools

**File:** `packages/chat/src/tools/platform.ts` (new)

6 tools as `ChatTool` instances: `listCodocs`, `getCodoc`, `createCodoc`, `updateCodoc`, `deleteCodoc`, `getWorkspaceStatus`.

Tool factories take a service callback interface:

```ts
interface PlatformToolDeps {
  listCodocs(workspaceId: WorkspaceId): Promise<...>;
  getCodoc(codocId: CodocId): Promise<...>;
  // etc.
}
```

Each tool closes over these deps. `runAgentTurn` use case constructs deps from `ServiceCtx`.

### Step 4.4: RSS domain tools

**File:** `packages/chat/src/tools/rss.ts` (new)

- `fetchRssFeedTool` — RSS parser, schema from legacy
- `fetchWebPageTool` — fetch + strip HTML, schema from legacy

### Step 4.5: Router agent

**File:** `packages/chat/src/agents/router.ts` (new)

- `createRouterAgent(availableAgents: { id, name, description }[]): ChatAgent`
- `run`: reads latest user message → calls LLM (Haiku) with classification prompt → returns `{ activeAgent: chosenId }`
- `model: "claude-haiku-4-5-20251001"`, `tools: []`
- Agent's `run(state, ctx)` casts ctx to `ChatRunContext` to access `ctx.llm`

### Step 4.6: General assistant specialist

**File:** `packages/chat/src/agents/general.ts` (new)

- `createGeneralAgent(tools: readonly ChatTool[]): ChatAgent`
- `run`: converts `state.messages` → calls LLM (Sonnet) → runs **tool-call loop** inside run (call LLM → if tool_use, execute tool, feed result back → repeat) → emits `ChatEvent` tokens/toolCalls/toolResults → constructs final `ChatMessage` with `kind: "assistant"` + `agentId` → emits `done` → returns `{ messages: [finalMessage] }`
- `model: "claude-sonnet-4-20250514"`, `tools: platformTools`
- System prompt adapted from legacy `DEFAULT_SYSTEM_PROMPT`

**Note:** The tool-call loop lives inside the agent's `run`, not in the executor. The executor treats each node as a single step; the agent's internal loop is transparent to the graph.

### Step 4.7: RSS specialist

**File:** `packages/chat/src/agents/rss.ts` (new)

- Same structure as general, with RSS tools added
- System prompt from legacy `RSS_SYSTEM_PROMPT`

### Step 4.8: Registry builder

**File:** `packages/chat/src/registry.ts` (new)

- `buildChatAgentRegistry(agents): ChatAgentRegistry` — Map-based
- `buildChatToolRegistry(tools): ChatToolRegistry` — Map-based

---

## Phase 5: `runAgentTurn` Composite Use Case (5a core)

### Step 5.1: Add `LlmConfig` port

**File:** `packages/service/src/ports/llm.ts` (new)

```ts
export interface LlmConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly routerModel?: string;  // default: haiku
  readonly defaultModel?: string; // default: sonnet
}
```

Add `readonly llmConfig: LlmConfig` to `ServiceCtx`. Wire in `apps/server` from `process.env` and in test helper as empty object.

### Step 5.2: `runAgentTurn` use case

**File:** `packages/service/src/usecases/agent/run-agent-turn.ts` (new)

**Input:** `{ threadId: ThreadId, content: string }`

**Output:** `{ userMessage: ThreadMessage, assistantMessages: readonly ThreadMessage[], events: readonly ChatEvent[] }`

**Logic:**
1. `withTransaction`
2. Read thread → fail if not found
3. Read thread's linked agents (`threadAgentRepo.listByThread`)
4. Read thread's linked codocs (`threadCodocRepo.listByThread`)
5. Read message history (`threadRepo.listMessages`)
6. Mint user `MessageId`, construct `ChatMessage { kind: "user" }`, append
7. `buildInitialState({ workspaceId, threadId, messages, pinnedCodocs, activeAgent: null })`
8. `createAnthropicLlmClient(ctx.llmConfig)`
9. Construct platform tools (closing over service ops from ctx)
10. Construct RSS tools
11. Construct router (with list of thread agents)
12. Construct specialist agents (filtered to thread's linked agents)
13. Build graph:
    - Entry: router node
    - Conditional edge from router → each specialist by `state.activeAgent`
    - Default branch → general assistant
    - Static edge from each specialist → `END`
14. `buildGraph(spec)` — return error if invalid
15. Collect events: `const events: ChatEvent[] = []`
16. `runChatTurn(graph, initialState, { emit: e => events.push(e), signal, llm })`
17. `eventsToAssistantMessages(events)` → append each to thread
18. Return `{ userMessage, assistantMessages, events }`

### Step 5.3: Seed agents on server boot

**File:** `apps/server/src/index.ts`

After creating `ServiceCtx`, seed `AgentStore` with:
- `{ id: "base", name: "Cobook Assistant", description: "General workspace assistant" }`
- `{ id: "rss", name: "RSS Reader", description: "Subscribe to RSS feeds, read articles, and save summaries" }`

Idempotent on restart.

### Step 5.4: Thread creation inherits workspace agents

**File:** `packages/service/src/usecases/thread/create-thread.ts`

After creating the thread, query `workspaceAgentRepo.listByWorkspace` and `threadAgentRepo.link` for each. Makes `createThread` a multi-store action requiring `withTransaction`.

### Step 5.5: Export from indexes

**Testable:** Use case test with mock `LlmClient`. Verify message append, graph build, event collection.

---

## Phase 6: Routes (5a — synchronous JSON)

### Step 6.1: Agent routes

**File:** `apps/server/src/routes/agents.ts` (new)

- `GET /api/agents` → `listAgents` → returns `AgentListItem[]`

### Step 6.2: Workspace agent routes

**File:** `apps/server/src/routes/workspaces.ts` (existing, add)

- `PUT /api/workspaces/:id/agents` → `setWorkspaceAgents` — body `{ agentIds }`, returns `{ agentIds }`

### Step 6.3: Thread agent + codoc routes

**File:** `apps/server/src/routes/threads.ts` (existing, add)

- `PUT /api/threads/:id/agents` → `setThreadAgents`
- `PUT /api/threads/:id/codocs` → `setThreadCodocs`

### Step 6.4: Agent turn endpoint (separate from `/messages`)

**File:** `apps/server/src/routes/threads.ts`

- `POST /api/threads/:id/turn` → `runAgentTurn` — returns `{ userMessage, assistantMessages }` as JSON
- Existing `POST /api/threads/:id/messages` stays as user-only append (slice 4 route unchanged)

### Step 6.5: Mount new routes in `apps/server/src/index.ts`

**Testable:** curl smoke tests against dev server.

---

## Phase 7: Web UI (5a)

### Step 7.1: API client additions

- `apps/web/src/api/agents.ts` (new) — `listAgents()`
- `apps/web/src/api/threads.ts` (update) — `setThreadAgents`, `setThreadCodocs`, `runAgentTurn`
- `apps/web/src/api/workspaces.ts` (update) — `setWorkspaceAgents`

### Step 7.2: Wire types

- `apps/web/src/types.ts` — add `AgentListItem`, extend `ChatMessage` with assistant variant (agentId, metadata.toolCalls)

### Step 7.3: Upgrade `ChatThreadPage`

- Thread detail query now returns `agentIds` and `codocIds`
- Agent picker (dropdown/multi-select) → `setThreadAgents` on change
- Codoc context picker → `setThreadCodocs` on change
- Assistant message rendering: role label shows agent name, styled differently
- Send calls `runAgentTurn` (5a sync); on success, invalidate thread query
- Tool call indicators on assistant messages (collapsed by default)

### Step 7.4: Workspace agent picker

- `apps/web/src/pages/workspace-detail.tsx` — add "Agents" section with multi-select toggle

### Step 7.5: `agentCount` badge

- `apps/web/src/pages/workspace-list.tsx` — display alongside `codocCount`

**Testable:** Dev server + browser — activate agents, create thread, send message, see sync response.

---

## Phase 8: SSE Streaming (5b)

### Step 8.1: `runAgentTurn` streaming callback

Add optional `onEvent` callback to input. Use case both collects events internally (for persistence) and forwards each to callback in real-time.

### Step 8.2: Active stream tracking

**File:** `apps/server/src/streaming.ts` (new, or in routes/threads.ts)

- `Map<ThreadId, ActiveStream>` — tracks in-progress streams
- Each event buffered for reconnect
- Pattern from legacy `chat-routes.ts`

### Step 8.3: Upgrade `POST /api/threads/:id/turn` to SSE

SSE event envelope:

```
event: token
data: {"delta":"Hello","nodeId":"base"}

event: toolCall
data: {"tool":"listCodocs","input":{},"nodeId":"base"}

event: toolResult
data: {"tool":"listCodocs","output":[...],"nodeId":"base"}

event: done
data: {"finalMessage":{...}}

event: error
data: {"message":"..."}
```

Handle client abort via `req.raw.signal`.

### Step 8.4: Reconnect endpoint

- `GET /api/threads/:id/stream` — replay buffered events from active stream, listen for new

### Step 8.5: Web client SSE

- `apps/web/src/api/threads.ts` — `runAgentTurnStream(threadId, content, handlers)` with `onToken/onToolCall/onToolResult/onDone/onError` + `{ abort }`

### Step 8.6: Streaming UI

- Replace sync call with `runAgentTurnStream`
- Real-time token rendering (optimistic assistant message)
- Tool call indicators during execution
- "Stop" button during streaming
- Reconnect on page load via `GET /api/threads/:id/stream`

### Step 8.7: Auto-title

After first assistant response on title-less thread:
- Haiku generates title (6 words max)
- Update thread title
- Emit `title-update` SSE event

**Testable:** Full e2e — send message, see streaming, abort, reconnect, `/verify-fix`.

---

## Phase 9: Cascade + Cleanup

### Step 9.1: `CodocStore.delete` referrer check

Wire `threadCodocs.listByCodoc` into codoc delete → return `CodocReferenced` on non-empty.

### Step 9.2: Update `docs/slices.md`

Document actual scope, stores replaced, conventions locked in.

### Step 9.3: Update AGENTS.md files

- `packages/graph/src/agents/AGENTS.md` — update router invariant (LLM-driven classifier, not "no LLM")
- `packages/chat/AGENTS.md` — document `ChatRunContext`, `LlmClient`
- `packages/service/src/usecases/agent/AGENTS.md` (new) — document use case conventions

---

## Dependency Graph

```
Phase 1 (Storage)
  └─ Phase 2 (Repos + CRUD)
       ├─ Phase 3 (Graph + Chat runtime)
       │    └─ Phase 4 (Agent + Tool defs)
       │         └─ Phase 5 (runAgentTurn)    ← 5a boundary
       │              └─ Phase 6 (Routes)
       │                   └─ Phase 7 (UI)
       │                        └─ Phase 8 (SSE)  ← 5b boundary
       └─ Phase 9 (cascades) ← can parallel with Phase 5+
```

## Suggested Session Splits

| Session | Phases | Verification |
|---|---|---|
| A | 1–3 | typecheck all packages + graph unit tests |
| B | 4–5 | `runAgentTurn` use case test (mock LLM) |
| C | 6–7 | curl + browser e2e (synchronous) |
| D | 8–9 | SSE streaming + reconnect + `/verify-fix` |

## Legacy Reference Files

- `legacy/packages/agent/src/base-agent.ts` — agent runtime (createBaseAgent, tool loop, max 10 iterations)
- `legacy/packages/agent/src/types.ts` — Agent, AgentContext, ChatEvent, LLMConfig
- `legacy/packages/agent/src/tools.ts` — 6 platform tool definitions + executeTool
- `legacy/packages/agent/src/rss-agent.ts` — RSS specialist (system prompt + fetchRssFeed/fetchWebPage)
- `legacy/packages/agent/src/claude-code-log-agent.ts` — log agent (reference for second specialist pattern)
- `legacy/apps/server/src/index.ts` — agent registration (Map-based), LLM config from env
- `legacy/apps/server/src/chat-routes.ts` — routing (@mention > LLM classification > fallback), SSE streaming, active stream tracking, message persistence, auto-title
