// DAG module — field-level dependency graph for codocs.
//
// Not a general-purpose graph library: node identity, edge semantics, and
// the build step are all coupled to codoc's `data` block and `$ref`
// resolution rules. Kept small and pure.

export type { DAG, DAGNode, DAGEdge } from "./types.js";

export { makeNodeId, parseNodeId } from "./node-id.js";
export type { ParsedNodeId } from "./node-id.js";

export { buildDAG } from "./build.js";
export type { BuildError } from "./build.js";

export { upstream, downstream } from "./query.js";

export { topoSort } from "./topo.js";
export type { TopoResult } from "./topo.js";

export { checkCycles } from "./cycle.js";
export type { CycleCheck, Cycle } from "./cycle.js";

export { invalidate } from "./invalidate.js";

export { evaluate } from "./evaluate.js";
