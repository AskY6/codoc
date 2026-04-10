import type { NodeId } from "../codoc/ids.js";
import type { DAG } from "./types.js";

/**
 * Outcome of a topological sort.
 *
 * - `sorted` — every node made it into `order`. The DAG is acyclic.
 * - `unsortable` — a cycle prevented a complete ordering. `sortedPrefix`
 *   contains every node that could be ordered; `remaining` contains every
 *   node that remained blocked (i.e. participates in or sits downstream of
 *   a cycle). Legacy silently dropped these — we now surface them.
 */
export type TopoResult =
  | { readonly kind: "sorted"; readonly order: readonly NodeId[] }
  | {
      readonly kind: "unsortable";
      readonly sortedPrefix: readonly NodeId[];
      readonly remaining: readonly NodeId[];
    };

/**
 * Kahn's algorithm — dependencies first.
 */
export function topoSort(dag: DAG): TopoResult {
  const inDegree = new Map<NodeId, number>();
  for (const id of dag.nodes.keys()) {
    inDegree.set(id, dag.dependencies.get(id)?.size ?? 0);
  }

  const queue: NodeId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: NodeId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);

    for (const dep of dag.dependents.get(id) ?? []) {
      const next = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }

  if (order.length === dag.nodes.size) {
    return { kind: "sorted", order };
  }

  const sorted = new Set(order);
  const remaining: NodeId[] = [];
  for (const id of dag.nodes.keys()) {
    if (!sorted.has(id)) remaining.push(id);
  }

  return { kind: "unsortable", sortedPrefix: order, remaining };
}
