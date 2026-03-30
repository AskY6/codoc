import type { DAG } from "./dag.js";

/**
 * Topological sort using Kahn's algorithm.
 * Returns nodes in dependency order (dependencies first).
 * Throws if the graph contains a cycle.
 */
export function topoSort(dag: DAG): string[] {
  const nodes = dag.getNodes();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node, dag.getDirectDeps(node).length);
  }

  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const dependent of dag.getDependents(node)) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (result.length !== nodes.length) {
    const cycle = dag.detectCycle();
    throw cycle ?? new Error("Cycle detected in DAG");
  }

  return result;
}
