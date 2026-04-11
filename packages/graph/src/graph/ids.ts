import type { Brand } from "@cobook/core";

/**
 * A node identifier inside a graph. Branded so that callers cannot
 * accidentally mix raw strings with node ids.
 *
 * Agent ids (see `@cobook/core`) are a separate brand — an Agent is
 * a kind of graph node, but the graph layer does not need to know
 * that. `GraphNode<S, E, Id>` is generic in its id so that Agents
 * can carry their own `AgentId` brand while still fitting the
 * node contract.
 */
export type NodeId = Brand<string, "NodeId">;

export const NodeId = (s: string): NodeId => s as NodeId;

/**
 * Sentinel node id indicating "graph is done". The executor stops
 * when a transition points at `END`.
 *
 * Implementation note: using a string sentinel is a pragmatic choice
 * for the skeleton. If user-defined node ids ever need to include
 * double-underscore prefixes we will swap this for a `Symbol`-based
 * sentinel.
 */
export const END: NodeId = "__END__" as NodeId;
