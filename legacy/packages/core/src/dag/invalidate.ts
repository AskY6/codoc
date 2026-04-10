import type { DAG } from "./dag.js";

/**
 * Starting from a dirty node, propagate downstream via BFS
 * and return all affected nodeIds (including the starting node).
 */
export function invalidate(dag: DAG, nodeId: string): string[] {
  const affected = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (affected.has(current)) continue;
    affected.add(current);

    for (const dep of dag.dependents.get(current) ?? []) {
      if (!affected.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return [...affected];
}
