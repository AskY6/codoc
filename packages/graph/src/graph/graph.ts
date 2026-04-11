import type { Result } from "@cobook/core";
import type { Edge } from "./edge.js";
import type { NodeId } from "./ids.js";
import type { GraphNode } from "./node.js";
import type { StateReducers } from "./state.js";

/**
 * An assembled graph, ready to hand to the executor. Holds the set
 * of nodes keyed by id, the edge list, the entry point, and the
 * per-field reducer table used to merge node updates back into the
 * running state.
 *
 * Graphs are treated as **values**: once built they are frozen, and
 * the executor does not mutate them. Changing topology means
 * rebuilding.
 */
export interface Graph<S, E> {
  readonly entry: NodeId;
  readonly nodes: ReadonlyMap<NodeId, GraphNode<S, E>>;
  readonly edges: readonly Edge<S>[];
  readonly reducers: StateReducers<S>;
}

/**
 * Input to `buildGraph`. Expressed as an array of nodes so that
 * callers can write the registration point-free; duplicate ids are
 * rejected by `buildGraph`.
 */
export interface GraphSpec<S, E> {
  readonly entry: NodeId;
  readonly nodes: readonly GraphNode<S, E>[];
  readonly edges: readonly Edge<S>[];
  readonly reducers?: StateReducers<S>;
}

/**
 * Errors `buildGraph` may return. These are structural problems
 * with the spec that prevent the executor from ever running it
 * correctly.
 */
export type BuildGraphError =
  | { readonly kind: "duplicateNode"; readonly id: NodeId }
  | { readonly kind: "unknownEntry"; readonly id: NodeId }
  | { readonly kind: "edgeFromUnknown"; readonly id: NodeId }
  | { readonly kind: "edgeToUnknown"; readonly id: NodeId }
  | { readonly kind: "unreachableNode"; readonly id: NodeId }
  | { readonly kind: "cycleDetected"; readonly at: NodeId };

/**
 * Construct a validated `Graph<S, E>` from a spec. Skeleton: the
 * implementation will eventually check id uniqueness, edge
 * well-formedness, reachability, and (since cycles are forbidden at
 * this stage) cycle absence.
 */
export declare function buildGraph<S, E>(
  spec: GraphSpec<S, E>,
): Result<Graph<S, E>, BuildGraphError>;
