import type { DAG } from "./dag.js";

/**
 * Kahn's algorithm — returns nodes in dependency order
 * (nodes with no dependencies first).
 *
 * If the graph has cycles, some nodes will be omitted from the result.
 */
export function topoSort(dag: DAG): string[] {
  const inDegree = new Map<string, number>();

  for (const id of dag.nodes.keys()) {
    inDegree.set(id, dag.dependencies.get(id)?.size ?? 0);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);

    for (const dep of dag.dependents.get(id) ?? []) {
      if (!inDegree.has(dep)) continue;
      const next = inDegree.get(dep)! - 1;
      inDegree.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }

  return result;
}
