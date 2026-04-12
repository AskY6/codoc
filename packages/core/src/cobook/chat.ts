import type { AgentId, MessageId, ThreadId, WorkspaceId } from "./ids.js";

/** A chat thread — the conversation container inside a workspace. */
export interface ChatThread {
  readonly id: ThreadId;
  readonly workspaceId: WorkspaceId;
  readonly title: string | null;
}

/** A single tool invocation recorded on an assistant message. */
export interface ToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** The output of a single tool execution, paired with the call by name. */
export interface ToolResult {
  readonly name: string;
  readonly output: unknown;
}

/** Metadata that only assistant messages carry. */
export interface AssistantMetadata {
  readonly toolCalls: readonly ToolCall[];
  readonly toolResults: readonly ToolResult[];
}

/**
 * ChatMessage as a role ADT.
 *
 * Each variant carries exactly the fields that make sense for it:
 * - `user` / `system` messages have no `agentId` and no tool-call metadata
 * - `assistant` messages ALWAYS carry `agentId` — anonymous assistants
 *   are unrepresentable, which is a hard architectural invariant of the
 *   router + specialist model.
 */
export type ChatMessage =
  | {
      readonly kind: "user";
      readonly id: MessageId;
      readonly threadId: ThreadId;
      readonly content: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: MessageId;
      readonly threadId: ThreadId;
      readonly content: string;
      readonly agentId: AgentId;
      readonly metadata: AssistantMetadata;
    }
  | {
      readonly kind: "system";
      readonly id: MessageId;
      readonly threadId: ThreadId;
      readonly content: string;
    };
