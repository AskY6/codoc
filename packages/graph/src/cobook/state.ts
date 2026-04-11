import type {
  AgentId,
  ChatMessage,
  CodocId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";

/**
 * The state flowing through a cobook-bound graph execution.
 *
 * This is the bridge between "generic mini-langgraph" and "cobook
 * runtime". Every agent node and every tool runs against this
 * shape, so the contract is deliberately narrow: just the
 * information needed for a cobook chat turn.
 *
 * Every field is expected to be treated as immutable — nodes return
 * `Partial<CobookState>` updates which the executor merges via
 * `StateReducers<CobookState>` (see `reducers.ts` for the canonical
 * table).
 */
export interface CobookState {
  /** Tenant boundary. Always set for cobook-bound runs. */
  readonly workspaceId: WorkspaceId;

  /**
   * The thread the run is attached to. `null` for workspace-scoped
   * runs that are not tied to a single conversation (matches
   * `AgentSession.threadId` in core).
   */
  readonly threadId: ThreadId | null;

  /**
   * Conversation history visible to the graph. Nodes append to
   * this via `Partial<CobookState>` updates; the reducer is the
   * "append" strategy (see `reducers.ts`).
   */
  readonly messages: readonly ChatMessage[];

  /**
   * Codocs pinned into the current context, in the order they
   * should be surfaced to the LLM. Identified by id only; the
   * graph layer never loads codoc content directly — that is a
   * concern of a dedicated loader tool or a higher layer that
   * seeds the state.
   */
  readonly pinnedCodocs: readonly CodocId[];

  /**
   * The agent currently expected to act next, if any. The router
   * / handoff logic writes this field; the executor uses it
   * (together with conditional edges) to decide which agent node
   * to enter.
   */
  readonly activeAgent: AgentId | null;
}
