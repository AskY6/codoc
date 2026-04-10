import type { CodocAST, DataField } from "../parser/schema.js";
import { parseRef } from "../ref/ref-parser.js";
import { normalizeRef } from "../ref/ref-normalizer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DAGNode {
  id: string;
  codocPath: string;
  fieldName: string;
  field: DataField;
}

export interface DAGEdge {
  /** The node that contains the $ref (dependent) */
  from: string;
  /** The node being referenced (dependency) */
  to: string;
}

export interface DAG {
  nodes: Map<string, DAGNode>;
  edges: DAGEdge[];
  /** nodeId → set of nodeIds this node depends on */
  dependencies: Map<string, Set<string>>;
  /** nodeId → set of nodeIds that depend on this node */
  dependents: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function makeNodeId(codocPath: string, fieldName: string): string {
  return `${codocPath}#data.${fieldName}`;
}

/**
 * Build a field-level DAG from a set of parsed codocs.
 * Keys in the map are workspace-relative codoc paths (e.g. "notes/meeting.codoc").
 */
export function buildDAG(codocs: Map<string, CodocAST>): DAG {
  const nodes = new Map<string, DAGNode>();
  const edges: DAGEdge[] = [];
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  const ensureSets = (id: string) => {
    if (!dependencies.has(id)) dependencies.set(id, new Set());
    if (!dependents.has(id)) dependents.set(id, new Set());
  };

  // 1. Create nodes
  for (const [codocPath, ast] of codocs) {
    if (!ast.data) continue;
    for (const [fieldName, field] of Object.entries(ast.data)) {
      const id = makeNodeId(codocPath, fieldName);
      nodes.set(id, { id, codocPath, fieldName, field });
      ensureSets(id);
    }
  }

  // 2. Create edges for $ref fields
  for (const [codocPath, ast] of codocs) {
    if (!ast.data) continue;
    for (const [fieldName, field] of Object.entries(ast.data)) {
      if (field.kind !== "ref") continue;

      const fromId = makeNodeId(codocPath, fieldName);
      const ref = parseRef(field.$ref);
      const toId = normalizeRef(ref, codocPath);

      edges.push({ from: fromId, to: toId });
      dependencies.get(fromId)!.add(toId);

      ensureSets(toId);
      dependents.get(toId)!.add(fromId);
    }
  }

  return { nodes, edges, dependencies, dependents };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get the nodeIds that this node directly depends on (upstream). */
export function getUpstream(dag: DAG, nodeId: string): string[] {
  return [...(dag.dependencies.get(nodeId) ?? [])];
}

/** Get the nodeIds that directly depend on this node (downstream). */
export function getDownstream(dag: DAG, nodeId: string): string[] {
  return [...(dag.dependents.get(nodeId) ?? [])];
}
