import type { Result } from "@cobook/core";
import type {
  ExecutionResult,
  NodeContext,
  RunGraphError,
} from "@cobook/graph";
import { runGraph } from "@cobook/graph";
import type { ChatEvent } from "../state/events.js";
import type { ChatGraph } from "../state/aliases.js";
import type { ChatState } from "../state/state.js";

/**
 * End-to-end driver for a single chat turn.
 *
 * Takes:
 * - `graph`: a chat-bound graph — built elsewhere, already validated.
 * - `initialState`: the `ChatState` seeded by `buildInitialState`.
 * - `ctx`: context providing `emit` and `signal`. Callers that need
 *   extra capabilities (e.g. `llm`) extend `NodeContext<ChatEvent>`
 *   (structural typing) and pass the richer object here.
 * - `signal` (optional): cooperative cancellation — passed through
 *   to `runGraph`.
 *
 * Returns the executor's result verbatim. Converting the final
 * state + collected events into persisted `ChatMessage`s is the
 * caller's responsibility (using `eventsToAssistantMessages`).
 */
export async function runChatTurn(
  graph: ChatGraph,
  initialState: ChatState,
  ctx: NodeContext<ChatEvent>,
  signal?: AbortSignal,
): Promise<Result<ExecutionResult<ChatState>, RunGraphError>> {
  const options: import("@cobook/graph").ExecutorOptions = { maxSteps: 50 };
  if (signal) {
    return runGraph(graph, initialState, ctx, { ...options, signal });
  }
  return runGraph(graph, initialState, ctx, options);
}
