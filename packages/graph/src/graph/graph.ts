import type { Result } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { Edge } from "./edge.js";
import { END, type NodeId } from "./ids.js";
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
 * Construct a validated `Graph<S, E>` from a spec.
 *
 * Validates: id uniqueness, entry existence, edge well-formedness
 * (all from/to refs exist), reachability from entry, and cycle
 * absence (DFS back-edge detection).
 */
export function buildGraph<S, E>(
  spec: GraphSpec<S, E>,
): Result<Graph<S, E>, BuildGraphError> {
  const nodeMap = new Map<NodeId, GraphNode<S, E>>();
  for (const node of spec.nodes) {
    if (nodeMap.has(node.id as NodeId)) {
      return err({ kind: "duplicateNode", id: node.id as NodeId });
    }
    nodeMap.set(node.id as NodeId, node);
  }

  if (!nodeMap.has(spec.entry)) {
    return err({ kind: "unknownEntry", id: spec.entry });
  }

  // Build adjacency list for reachability / cycle checks.
  const adj = new Map<NodeId, NodeId[]>();
  for (const node of spec.nodes) {
    adj.set(node.id as NodeId, []);
  }

  for (const edge of spec.edges) {
    if (!nodeMap.has(edge.from)) {
      return err({ kind: "edgeFromUnknown", id: edge.from });
    }
    if (edge.kind === "static") {
      if (edge.to !== END && !nodeMap.has(edge.to)) {
        return err({ kind: "edgeToUnknown", id: edge.to });
      }
      adj.get(edge.from)!.push(edge.to);
    } else {
      for (const branch of edge.branches) {
        if (branch.to !== END && !nodeMap.has(branch.to)) {
          return err({ kind: "edgeToUnknown", id: branch.to });
        }
        adj.get(edge.from)!.push(branch.to);
      }
    }
  }

  // Reachability: BFS from entry.
  const visited = new Set<NodeId>();
  const queue: NodeId[] = [spec.entry];
  visited.add(spec.entry);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (neighbor === END) continue;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  for (const node of spec.nodes) {
    if (!visited.has(node.id as NodeId)) {
      return err({ kind: "unreachableNode", id: node.id as NodeId });
    }
  }

  // Cycle detection: DFS back-edge.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<NodeId, number>();
  for (const node of spec.nodes) {
    color.set(node.id as NodeId, WHITE);
  }

  function dfs(nodeId: NodeId): NodeId | null {
    color.set(nodeId, GRAY);
    const neighbors = adj.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (neighbor === END) continue;
      const c = color.get(neighbor);
      if (c === GRAY) return neighbor;
      if (c === WHITE) {
        const cycle = dfs(neighbor);
        if (cycle !== null) return cycle;
      }
    }
    color.set(nodeId, BLACK);
    return null;
  }

  const cycleNode = dfs(spec.entry);
  if (cycleNode !== null) {
    return err({ kind: "cycleDetected", at: cycleNode });
  }

  return ok({
    entry: spec.entry,
    nodes: nodeMap,
    edges: spec.edges,
    reducers: spec.reducers ?? ({} as StateReducers<S>),
  });
}
