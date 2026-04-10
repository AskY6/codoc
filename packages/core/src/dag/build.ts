import type { CodocAST } from "../codoc/ast.js";
import type { CodocPath, FieldName, NodeId } from "../codoc/ids.js";
import { resolveRef } from "../codoc/ref.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import type { DAG, DAGEdge, DAGNode } from "./types.js";
import { makeNodeId } from "./node-id.js";

/**
 * Reasons a DAG build can fail.
 *
 * - `unknown-target` — a ref points at a NodeId that no codoc in the
 *   supplied set produces. Legacy silently created a dangling edge;
 *   the new behaviour is to fail loudly so the caller can surface it.
 */
export type BuildError = {
  readonly kind: "unknown-target";
  readonly source: NodeId;
  readonly target: NodeId;
  readonly fromCodoc: CodocPath;
  readonly fromField: FieldName;
};

/**
 * Build a field-level DAG from a set of parsed codocs.
 *
 * Returns a `Result`:
 * - `ok`  → a fully-populated, immutable DAG
 * - `err` → a list of build errors (all detected in a single pass; we do
 *           not short-circuit on the first failure)
 */
export function buildDAG(
  codocs: ReadonlyMap<CodocPath, CodocAST>,
): Result<DAG, readonly BuildError[]> {
  const nodes = new Map<NodeId, DAGNode>();
  const edges: DAGEdge[] = [];
  const dependencies = new Map<NodeId, Set<NodeId>>();
  const dependents = new Map<NodeId, Set<NodeId>>();
  const errors: BuildError[] = [];

  // Pass 1 — materialise every field as a DAG node.
  for (const [codocPath, ast] of codocs) {
    for (const [fieldName, field] of ast.data) {
      const id = makeNodeId(codocPath, fieldName);
      nodes.set(id, { id, codocPath, fieldName, field });
      dependencies.set(id, new Set());
      dependents.set(id, new Set());
    }
  }

  // Pass 2 — add edges for ref fields; fail unknown targets.
  for (const [codocPath, ast] of codocs) {
    for (const [fieldName, field] of ast.data) {
      if (field.kind !== "ref") continue;

      const from = makeNodeId(codocPath, fieldName);
      const to = resolveRef(field.ref, codocPath);

      if (!nodes.has(to)) {
        errors.push({
          kind: "unknown-target",
          source: from,
          target: to,
          fromCodoc: codocPath,
          fromField: fieldName,
        });
        continue;
      }

      edges.push({ from, to });
      dependencies.get(from)!.add(to);
      dependents.get(to)!.add(from);
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({
    nodes,
    edges,
    dependencies,
    dependents,
  });
}
