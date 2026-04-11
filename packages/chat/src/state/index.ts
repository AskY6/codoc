// state/ — the chat specialization layer. This is the ONLY
// subtree in @cobook/chat that names the concrete <S, E> pair
// (ChatState, ChatEvent) used by the chat runtime.
//
// Every other subtree imports the aliases below instead of
// repeating the generics; every future site that needs to swap
// the state/event shape changes one file — this one.

export type { ChatState } from "./state.js";
export type { ChatEvent } from "./events.js";
export { chatReducers } from "./reducers.js";
export type {
  ChatTool,
  ChatAgent,
  ChatToolRegistry,
  ChatAgentRegistry,
  ChatGraph,
} from "./aliases.js";
