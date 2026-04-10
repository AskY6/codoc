import type { NodeId } from "../codoc/ids.js";
import type { DAG } from "./types.js";

/**
 * A single cycle, recorded as the sequence of NodeIds that form the loop.
 * The first and last element are the same node (the entry point).
 */
export interface Cycle {
  readonly path: readonly NodeId[];
}

/**
 * Result of a cycle check.
 *
 * Encoded as an ADT rather than a possibly-empty array so that callers
 * must explicitly handle both the "clean" and "dirty" branches.
 */
export type CycleCheck =
  | { readonly kind: "acyclic" }
  | { readonly kind: "cyclic"; readonly cycles: readonly Cycle[] };

/**
 * Walk the graph with DFS colouring. Every back edge discovered becomes
 * one reported cycle. Nodes outside the graph (e.g. dangling targets in
 * malformed inputs) are ignored — buildDAG rejects those upstream.
 */
export function checkCycles(dag: DAG): CycleCheck {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<NodeId, number>();
  for (const id of dag.nodes.keys()) color.set(id, WHITE);

  const stack: NodeId[] = [];
  const cycles: Cycle[] = [];

  const dfs = (id: NodeId): void => {
    color.set(id, GRAY);
    stack.push(id);

    for (const dep of dag.dependencies.get(id) ?? []) {
      const c = color.get(dep);
      if (c === undefined) continue;

      if (c === GRAY) {
        const start = stack.indexOf(dep);
        const loop = stack.slice(start);
        loop.push(dep);
        cycles.push({ path: loop });
      } else if (c === WHITE) {
        dfs(dep);
      }
    }

    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of dag.nodes.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }

  if (cycles.length === 0) return { kind: "acyclic" };
  return { kind: "cyclic", cycles };
}
