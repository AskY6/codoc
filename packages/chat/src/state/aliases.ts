import type {
  Agent,
  AgentRegistry,
  Graph,
  Tool,
  ToolRegistry,
} from "@cobook/graph";
import type { ChatEvent } from "./events.js";
import type { ChatState } from "./state.js";

/**
 * Concrete bindings of the generic `@cobook/graph` tool / agent
 * contracts to the chat `<S, E>` pair. This is the **only** place
 * in this package where `Tool<ChatState, ChatEvent>` and friends
 * get spelled out — every downstream consumer imports these
 * aliases instead of repeating the generics.
 *
 * Keeping the alias layer this thin is deliberate:
 * - one edit site when / if `@cobook/graph` reworks its tool
 *   contract (e.g. dropping `E` from `Tool`)
 * - no risk of two files picking different `<S, E>` pairs
 * - the generic framework layer in `@cobook/graph` stays reusable
 *   for any future non-chat application
 */
export type ChatTool = Tool<ChatState, ChatEvent>;

export type ChatAgent = Agent<ChatState, ChatEvent>;

export type ChatToolRegistry = ToolRegistry<ChatState, ChatEvent>;

export type ChatAgentRegistry = AgentRegistry<ChatState, ChatEvent>;

/**
 * Aliased `Graph` container for the chat `<S, E>` pair. Not a
 * contract (nothing *implements* a Graph — it's a value produced
 * by `buildGraph`), but aliasing it here keeps the "only one site
 * writes `<ChatState, ChatEvent>`" invariant intact.
 */
export type ChatGraph = Graph<ChatState, ChatEvent>;
