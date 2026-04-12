import type { StateReducers } from "@cobook/graph";
import type { ChatState } from "./state.js";

/**
 * Canonical reducer table for `ChatState`.
 *
 * - `messages`: **append**. Every node that emits assistant / tool
 *   messages contributes by returning a `Partial<ChatState>` with
 *   a `messages` array of just the new messages; the reducer
 *   concatenates them onto the running history.
 * - `pinnedCodocs`: **append**. Same idea — nodes that pin a new
 *   codoc return only the new ids.
 * - Every other field (`workspaceId`, `threadId`, `activeAgent`)
 *   uses the default "last write wins" strategy, which means
 *   omitting them from this table is correct.
 */
export const chatReducers: StateReducers<ChatState> = {
  messages: (prev, incoming) => [...prev, ...incoming],
  pinnedCodocs: (prev, incoming) => [...prev, ...incoming],
};
