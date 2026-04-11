import type {
  AgentId,
  ChatMessage,
  CodocId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import type { ChatEvent, ChatState } from "../state/index.js";

/**
 * Seed a fresh `ChatState` from the persisted thread view.
 *
 * Inputs mirror what a service layer would have on hand at the
 * start of a chat turn: the tenant boundary, which thread (if
 * any), the messages visible to the graph, any pinned codocs,
 * and the agent expected to act first. This is pure construction
 * — no I/O, no validation beyond what `ChatState` requires.
 *
 * Skeleton: the body will be added alongside `runChatTurn` in a
 * later session. The signature locks the inbound contract.
 */
export declare function buildInitialState(params: {
  readonly workspaceId: WorkspaceId;
  readonly threadId: ThreadId | null;
  readonly messages: readonly ChatMessage[];
  readonly pinnedCodocs: readonly CodocId[];
  readonly activeAgent: AgentId | null;
}): ChatState;

/**
 * Fold a stream of `ChatEvent`s into the assistant-facing
 * `ChatMessage[]` a UI / persistence layer can consume.
 *
 * This is the **outbound** half of the adapter: it takes the
 * events the graph streamed out during a turn and produces the
 * assistant messages the thread should store. Tool calls / token
 * deltas that don't correspond to a final assistant message are
 * consumed during the fold and do not leak out as their own
 * `ChatMessage`.
 *
 * Skeleton: exact rules TBD alongside the runner. The signature
 * is enough to pin the direction (events in, messages out).
 */
export declare function eventsToAssistantMessages(
  events: readonly ChatEvent[],
): readonly ChatMessage[];
