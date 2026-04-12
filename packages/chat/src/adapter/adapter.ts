import type {
  AgentId,
  ChatMessage,
  CodocId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import type { ChatEvent } from "../state/events.js";
import type { ChatState } from "../state/state.js";

/**
 * Seed a fresh `ChatState` from the persisted thread view.
 *
 * Pure construction — no I/O, no validation beyond what `ChatState`
 * requires. Inputs mirror what a service layer would have on hand
 * at the start of a chat turn.
 */
export function buildInitialState(params: {
  readonly workspaceId: WorkspaceId;
  readonly threadId: ThreadId | null;
  readonly messages: readonly ChatMessage[];
  readonly pinnedCodocs: readonly CodocId[];
  readonly activeAgent: AgentId | null;
}): ChatState {
  return {
    workspaceId: params.workspaceId,
    threadId: params.threadId,
    messages: params.messages,
    pinnedCodocs: params.pinnedCodocs,
    activeAgent: params.activeAgent,
  };
}

/**
 * Fold a stream of `ChatEvent`s into the assistant-facing
 * `ChatMessage[]` a UI / persistence layer can consume.
 *
 * Filters for `kind === "done"` events and returns their
 * `finalMessage` fields. Token deltas, tool calls, and tool results
 * are transient streaming artifacts and are not surfaced as messages.
 */
export function eventsToAssistantMessages(
  events: readonly ChatEvent[],
): readonly ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const event of events) {
    if (event.kind === "done") {
      messages.push(event.finalMessage);
    }
  }
  return messages;
}
