import type { NodeId } from "../codoc/ids.js";
import type { DAG } from "./types.js";

/**
 * Given a "seed" node whose value has become dirty, walk the dependents
 * graph (BFS) and return every downstream node that transitively depends
 * on the seed. The returned list includes the seed itself.
 *
 * Pure — does not mutate the DAG or any node state. Callers decide what
 * to do with the affected set (flip state, enqueue recompute, etc.).
 */
export function invalidate(dag: DAG, seed: NodeId): readonly NodeId[] {
  const affected = new Set<NodeId>();
  const queue: NodeId[] = [seed];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (affected.has(current)) continue;
    affected.add(current);

    for (const dep of dag.dependents.get(current) ?? []) {
      if (!affected.has(dep)) queue.push(dep);
    }
  }

  return [...affected];
}
