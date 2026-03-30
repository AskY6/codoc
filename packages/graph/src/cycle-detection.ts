import type { CyclicDependencyError } from "./types.js";

/**
 * Detect if the graph has a cycle using Kahn's algorithm.
 * Returns null if acyclic, or a CyclicDependencyError with the cycle path.
 */
export function detectCycle(
  nodes: string[],
  getDeps: (id: string) => string[],
  getDependents: (id: string) => string[],
): CyclicDependencyError | null {
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node, getDeps(node).length);
  }

  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const dependent of getDependents(node)) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (processed === nodes.length) return null;

  const cycle = findCyclePath(inDegree, getDeps);
  return {
    kind: "cyclic_dependency",
    message: `Cyclic dependency detected: ${cycle.join(" → ")}`,
    cycle,
  };
}

function findCyclePath(
  inDegree: Map<string, number>,
  getDeps: (id: string) => string[],
): string[] {
  const inCycle = new Set<string>();
  for (const [node, degree] of inDegree) {
    if (degree > 0) inCycle.add(node);
  }

  if (inCycle.size === 0) return [];

  const start = inCycle.values().next().value!;
  const visited = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): string[] | null => {
    if (visited.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        return [...path.slice(cycleStart), node];
      }
      return null;
    }
    visited.add(node);
    path.push(node);
    for (const dep of getDeps(node)) {
      if (inCycle.has(dep)) {
        const result = dfs(dep);
        if (result) return result;
      }
    }
    path.pop();
    return null;
  };

  return dfs(start) ?? [start];
}
