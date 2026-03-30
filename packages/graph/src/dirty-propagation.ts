import type { DAG } from "./dag.js";

/**
 * BFS downstream from changed nodes to collect all affected dependents.
 * Returns the set of dirty paths in topological order (dependencies first).
 * Does NOT include the changed nodes themselves — only their downstream dependents.
 */
export function propagateDirty(dag: DAG, changedPaths: string[]): string[] {
  const dirty = new Set<string>();
  const queue: string[] = [];

  for (const path of changedPaths) {
    for (const dependent of dag.getDependents(path)) {
      if (!dirty.has(dependent)) {
        dirty.add(dependent);
        queue.push(dependent);
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dag.getDependents(current)) {
      if (!dirty.has(dependent)) {
        dirty.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return topoSortSubset(dag, dirty);
}

/**
 * Topological sort of a subset of nodes within the DAG.
 */
function topoSortSubset(dag: DAG, subset: Set<string>): string[] {
  if (subset.size === 0) return [];

  const inDegree = new Map<string, number>();
  for (const node of subset) {
    let degree = 0;
    for (const dep of dag.getDirectDeps(node)) {
      if (subset.has(dep)) degree++;
    }
    inDegree.set(node, degree);
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
      if (inDegree.has(dependent)) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }
  }

  return result;
}
