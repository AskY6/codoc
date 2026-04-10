import type { NodeId } from "../codoc/ids.js";
import type { DAG } from "./types.js";

/** NodeIds that `nodeId` directly depends on (upstream, immediate). */
export function upstream(dag: DAG, nodeId: NodeId): readonly NodeId[] {
  const set = dag.dependencies.get(nodeId);
  return set ? [...set] : [];
}

/** NodeIds that directly depend on `nodeId` (downstream, immediate). */
export function downstream(dag: DAG, nodeId: NodeId): readonly NodeId[] {
  const set = dag.dependents.get(nodeId);
  return set ? [...set] : [];
}
