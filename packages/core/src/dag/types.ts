import type { CodocPath, FieldName, NodeId } from "../codoc/ids.js";
import type { DataField } from "../codoc/data.js";

/**
 * A single field-level vertex in the DAG.
 *
 * `id` is the canonical NodeId encoding (`<codocPath>#data.<fieldName>`);
 * `codocPath` / `fieldName` / `field` are cached for fast traversal without
 * re-parsing the id.
 */
export interface DAGNode {
  readonly id: NodeId;
  readonly codocPath: CodocPath;
  readonly fieldName: FieldName;
  readonly field: DataField;
}

/** A directed edge: the `from` node depends on the `to` node. */
export interface DAGEdge {
  readonly from: NodeId;
  readonly to: NodeId;
}

/**
 * Immutable DAG snapshot.
 *
 * `dependencies` and `dependents` are pre-built adjacency indices so that
 * upstream / downstream queries are O(1) lookups, not O(edges) scans.
 */
export interface DAG {
  readonly nodes: ReadonlyMap<NodeId, DAGNode>;
  readonly edges: readonly DAGEdge[];
  /** nodeId → set of nodeIds this node depends on (upstream). */
  readonly dependencies: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  /** nodeId → set of nodeIds that depend on this node (downstream). */
  readonly dependents: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
}
