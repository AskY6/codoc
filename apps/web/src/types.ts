// Wire-level DTO mirrors. Brands are stripped — over the network
// `WorkspaceId` is just `string`. We don't import from `@cobook/core`
// because the web app deliberately keeps zero coupling to the
// backend type system; the wire is the only contract.

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface WorkspaceListItem {
  readonly workspace: Workspace;
  readonly updatedAt: number;
  // Opaque optimistic-concurrency token. Echo back in `expectedRev`
  // on update; never parse or compare beyond equality.
  readonly rev: string;
  readonly codocCount: number;
  readonly agentCount: number;
}

// Flattened on the wire (unlike WorkspaceListItem) because the
// backend's canonical Codoc type holds `ReadonlyMap`s that JSON
// serialise to `{}` — nesting would silently lose data. See the
// backend's packages/service/src/types/codoc.ts for the rationale.
export interface CodocListItem {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  readonly updatedAt: number;
  readonly rev: string;
}

// Detail DTO returned by GET /api/codocs/:id. Adds raw `content` on
// top of the list item; the ast is deliberately server-side only.
export interface CodocDetail {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  readonly content: string;
  readonly updatedAt: number;
  readonly rev: string;
}

// Chat thread / message wire DTOs for slice 4.
//
// Thread DTOs nest the canonical backend type (`thread: ChatThread`)
// just like `WorkspaceListItem` — the core type holds only primitives,
// so JSON serialisation is safe (unlike `CodocListItem`, which is
// flattened because `Codoc.ast` holds non-serialisable maps).

export interface ChatThread {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string | null;
}

export interface ThreadListItem {
  readonly thread: ChatThread;
  readonly updatedAt: number;
  // Opaque optimistic-concurrency token, same rules as workspace.rev.
  readonly rev: string;
}

// A single tool invocation recorded on an assistant message.
export interface ToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface AssistantMetadata {
  readonly toolCalls: readonly ToolCall[];
}

// Role ADT: user messages have no agentId; assistant messages always
// carry agentId + metadata (anonymous assistants are unrepresentable).
export type ChatMessage =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly threadId: string;
      readonly content: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly threadId: string;
      readonly content: string;
      readonly agentId: string;
      readonly metadata: AssistantMetadata;
    }
  | {
      readonly kind: "system";
      readonly id: string;
      readonly threadId: string;
      readonly content: string;
    };

export interface ThreadMessage {
  readonly message: ChatMessage;
  // Per-thread monotonic ordering key assigned by the server. Clients
  // treat it as opaque; combined with `message.id` it is the canonical
  // pagination cursor for future slices.
  readonly seq: number;
  readonly createdAt: number;
}

export interface ThreadDetail {
  readonly thread: ThreadListItem;
  readonly messages: readonly ThreadMessage[];
  readonly agentIds: readonly string[];
  readonly codocIds: readonly string[];
}

// Agent wire DTOs.

export interface AgentListing {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface AgentListItem {
  readonly listing: AgentListing;
  readonly createdAt: number;
}

// Response from POST /api/threads/:id/turn (synchronous agent turn).
export interface RunAgentTurnResponse {
  readonly userMessage: ThreadMessage;
  readonly assistantMessages: readonly ThreadMessage[];
}

export interface ServiceErrorBody {
  readonly error: { readonly kind: string; readonly [k: string]: unknown };
}
