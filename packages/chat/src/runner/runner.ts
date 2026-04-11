import type { Result } from "@cobook/core";
import type { ExecutionResult, RunGraphError } from "@cobook/graph";
import type {
  ChatEvent,
  ChatGraph,
  ChatState,
} from "../state/index.js";

/**
 * End-to-end driver for a single chat turn.
 *
 * Takes:
 * - `graph`: a chat-bound graph — built elsewhere (e.g. by a
 *   service layer wiring together the registered agents and
 *   tools). Already validated via `buildGraph`; this function
 *   does not re-validate.
 * - `initialState`: the `ChatState` seeded by
 *   `../adapter/buildInitialState` at the start of the turn.
 * - `onEvent`: a sink for `ChatEvent`s produced while the graph
 *   runs. Called synchronously in emission order.
 * - `signal` (optional): cooperative cancellation — passed through
 *   to `runGraph`.
 *
 * Returns the executor's result verbatim. Converting the final
 * state + collected events into persisted `ChatMessage`s is the
 * caller's responsibility (using `../adapter/eventsToAssistantMessages`).
 *
 * Skeleton: body to be added in a later session. The signature
 * is enough to lock the runner's contract with both the graph
 * layer and the calling service layer.
 */
export declare function runChatTurn(
  graph: ChatGraph,
  initialState: ChatState,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<Result<ExecutionResult<ChatState>, RunGraphError>>;
