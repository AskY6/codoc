import type { ReactiveGraph, CyclicDependencyError } from "./types.js";
import { DAG } from "./dag.js";
import { topoSort } from "./topo-sort.js";
import { parallelLayers } from "./parallel-layers.js";
import { propagateDirty } from "./dirty-propagation.js";

/**
 * Composition entry point: implements the ReactiveGraph interface
 * by combining DAG, topoSort, parallelLayers, and propagateDirty.
 */
export function createReactiveGraph(): ReactiveGraph {
  const dag = new DAG();

  return {
    addNode: (id) => dag.addNode(id),
    removeNode: (id) => dag.removeNode(id),
    addEdge: (from, to) => dag.addEdge(from, to),
    removeEdge: (from, to) => dag.removeEdge(from, to),
    getNodes: () => dag.getNodes(),
    getDirectDeps: (id) => dag.getDirectDeps(id),
    getDependents: (id) => dag.getDependents(id),
    hasNode: (id) => dag.hasNode(id),
    detectCycle: (): CyclicDependencyError | null => dag.detectCycle(),
    topoSort: () => topoSort(dag),
    topoLayers: () => parallelLayers(dag),
    propagateDirty: (changedPaths) => propagateDirty(dag, changedPaths),
  };
}
