import type { DataTree } from "@codoc/core";
import type { DAG } from "@codoc/graph";
import { propagateDirty } from "@codoc/graph";

/**
 * Propagate dirty and mark fields on a DataTree.
 * Returns the list of invalidated paths in topological order.
 */
export function propagateAndInvalidate(
  dag: DAG,
  tree: DataTree,
  changedPaths: string[]
): string[] {
  const dirtyPaths = propagateDirty(dag, changedPaths);
  for (const path of dirtyPaths) {
    tree.invalidateField(path);
  }
  return dirtyPaths;
}
