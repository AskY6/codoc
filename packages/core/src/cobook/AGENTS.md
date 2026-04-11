# cobook/

The **collaboration boundary layer**: workspaces, agents, chat threads, messages, sessions, and the join records that tie them to codocs.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — global invariants.
Reads from: [`../codoc/AGENTS.md`](../codoc/AGENTS.md), but **only `CodocId`**. Cobook never touches `CodocAST`, `DataField`, or any codoc internals.
Must never import from: `dag/`.

## Why this layer exists

`codoc/` and `dag/` know nothing about **who** owns a document or **where** it lives. That's intentional: a codoc is a value, not a row in someone's workspace. `cobook/` is the only place where tenancy, authorship, and conversation live.

**If a feature involves `workspaceId`, it belongs here. Full stop.**

## IDs (`ids.ts`)

All branded strings (see [`../shared/AGENTS.md`](../shared/AGENTS.md)).

| ID | Owner entity |
|---|---|
| `WorkspaceId` | `AgentListing` / `Workspace` |
| `AgentId` | `AgentListing` |
| `ThreadId` | `ChatThread` |
| `MessageId` | `ChatMessage` |
| `SessionId` | `AgentSession` |

## Entities

### `Workspace` (`workspace.ts`)

```ts
interface Workspace {
  id: WorkspaceId;
  name: string;
  description: string | null;
}
```

The tenancy boundary. No timestamps, no owner — storage adds those in its own projection.

### `AgentListing` (`agent.ts`)

```ts
interface AgentListing {
  id: AgentId;
  name: string;
  description: string;
}
```

This is the **declarative directory record** — "an agent named X exists in this workspace". It deliberately carries no behaviour (no system prompt, no model, no tool list).

The runtime `Agent` interface — the one that plugs into the graph executor and actually runs LLM calls — lives in `@cobook/graph/agents` and must not be imported from core. If you find yourself wanting to add `systemPrompt` or `toolIds` here, you are in the wrong package.

### `ChatThread` / `ChatMessage` (`chat.ts`)

```ts
interface ChatThread {
  id: ThreadId;
  workspaceId: WorkspaceId;
  title: string | null;
}
```

`ChatMessage` is a **3-variant role ADT**:

```ts
type ChatMessage =
  | { kind: "user";      id; threadId; content }
  | { kind: "assistant"; id; threadId; content; agentId; metadata: AssistantMetadata }
  | { kind: "system";    id; threadId; content };
```

### Hard invariants on `ChatMessage`

- **Only `assistant` carries `agentId`.** User and system messages have no author agent.
- **`assistant` messages ALWAYS carry `agentId`.** An anonymous assistant is unrepresentable — this is the architectural invariant of the router + specialist model. Do not add a fallback to "some default agent"; fix whatever produced the authorless message.
- **Only `assistant` carries tool-call metadata** (`AssistantMetadata.toolCalls: readonly ToolCall[]`).

When adding a new message role, add a new `kind` variant — do not introduce optional fields on existing variants.

### `AgentSession` (`session.ts`)

```ts
interface AgentSession {
  id: SessionId;
  workspaceId: WorkspaceId;
  threadId: ThreadId | null;       // null ⇒ workspace-scoped, not thread-scoped
  activeSceneId: string | null;
  state: Readonly<Record<string, unknown>>;  // opaque, agent-specific
}
```

Cross-turn private state held by an agent. `state` is deliberately opaque — its shape is agent-specific and core does not define it.

## Membership / join records (`membership.ts`)

Three join records — each is a **value object identified by its composite key**. No surrogate `id`, no timestamps. Storage backends add those in their persisted projections.

```ts
interface WorkspaceAgent { workspaceId; agentId; }   // agent enabled in a workspace
interface ThreadCodoc    { threadId;    codocId; }   // codoc pinned into a thread
interface ThreadAgent    { threadId;    agentId; }   // agent activated in a thread
```

### `ThreadCodoc` — the cross-layer bridge

This is the **only** place where a cobook concept (`ThreadId`) and a codoc concept (`CodocId`) meet. The join lives here, not in `codoc/`, because tenancy-flavoured relationships belong to the tenancy layer. `codoc/` remains unaware that anyone is pinning it into anything.

## When editing this subtree

- **Never import from `dag/`.** Cobook and dag are siblings; they do not know about each other.
- **Never read codoc internals.** If you find yourself importing `CodocAST` or `DataField` here, the logic belongs in `codoc/` (or in a higher layer that composes the two), not in `cobook/`.
- **Never add row metadata** (`createdAt`, `updatedAt`, `createdBy`) to a core entity. Storage owns those.
- **Prefer composite keys over surrogates** for join records. If you need a surrogate, add it in the storage projection, not here.
- **Adding a new chat role or tool-call shape = adding a new ADT variant**, not an optional field.
