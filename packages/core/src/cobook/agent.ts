import type { AgentId } from "./ids.js";

/**
 * Declarative agent listing.
 *
 * This is the persisted "here is an agent that exists" record —
 * enough to list, register, or reference an agent by id in a
 * workspace directory. It deliberately contains no behaviour: no
 * system prompt, no model binding, no tool list.
 *
 * The runtime `Agent` interface — the one that plugs into the graph
 * executor and actually runs — lives in `@cobook/graph/agents` and
 * must not be imported from core.
 */
export interface AgentListing {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
}
