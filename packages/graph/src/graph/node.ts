import type { NodeId } from "./ids.js";

/**
 * Runtime-provided context a node uses while it runs.
 *
 * `emit` streams intermediate events (token deltas, tool call
 * announcements, etc.) to the executor's caller. Emission is
 * fire-and-forget from the node's point of view.
 *
 * `signal` lets a node cooperate with cancellation — for example,
 * aborting an in-flight LLM request when the outer chat turn is
 * cancelled.
 */
export interface NodeContext<E> {
  readonly emit: (event: E) => void;
  readonly signal: AbortSignal;
}

/**
 * The graph's primitive unit of work. A node reads the current
 * state, possibly calls an external service (LLM, tool, human), and
 * returns a `Partial<S>` describing the fields it wants to update.
 *
 * `Id` defaults to `NodeId` for generic nodes but is open so that
 * specialized node kinds — notably `Agent`, identified by `AgentId`
 * from `@cobook/core` — can carry their own brand without casting.
 *
 * A node's `run` must be pure with respect to `state` (no mutation);
 * it returns a partial update that the executor will merge via the
 * graph's `StateReducers<S>`.
 */
export interface GraphNode<S, E, Id extends string = NodeId> {
  readonly id: Id;
  readonly run: (state: S, ctx: NodeContext<E>) => Promise<Partial<S>>;
}
