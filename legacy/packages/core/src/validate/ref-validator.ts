import type { DAG } from "../dag/dag.js";

export interface RefValidationResult {
  valid: boolean;
  errors: { from: string; to: string; message: string }[];
}

/**
 * Check that every $ref edge in the DAG points to an existing node.
 */
export function validateRefs(dag: DAG): RefValidationResult {
  const errors: { from: string; to: string; message: string }[] = [];

  for (const edge of dag.edges) {
    if (!dag.nodes.has(edge.to)) {
      errors.push({
        from: edge.from,
        to: edge.to,
        message: `Reference target "${edge.to}" does not exist`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
