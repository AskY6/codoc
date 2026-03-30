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

/**
 * Topological sort with layer grouping.
 * Returns an array of layers, where each layer contains nodes
 * that can be evaluated in parallel (no intra-layer dependencies).
 */
export function topoLayers(dag: DAG): string[][] {
  const nodes = dag.getNodes();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node, dag.getDirectDeps(node).length);
  }

  const layers: string[][] = [];
  let remaining = nodes.length;

  while (remaining > 0) {
    const layer: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) layer.push(node);
    }

    if (layer.length === 0) {
      const cycle = dag.detectCycle();
      throw cycle ?? new Error("Cycle detected in DAG");
    }

    for (const node of layer) {
      inDegree.delete(node);
      for (const dependent of dag.getDependents(node)) {
        if (inDegree.has(dependent)) {
          inDegree.set(dependent, inDegree.get(dependent)! - 1);
        }
      }
    }

    layers.push(layer);
    remaining -= layer.length;
  }

  return layers;
}
