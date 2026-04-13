import type { NodeId } from "../codoc/ids.js";
import type { ResolveResult } from "../codoc/resolved.js";
import type { DAG } from "./types.js";
import { topoSort } from "./topo.js";

/**
 * Pure, synchronous evaluation of every node in a DAG.
 *
 * Walks the topologically-sorted order and resolves each node:
 *
 * - `static` — `{ kind: "ready", value: field.value }`
 * - `ref`    — looks up the target's already-computed result in the
 *              accumulator. If the target is `ready`, propagates its
 *              value; if `error`, propagates the error with a causal chain.
 * - `source` — looks up a pre-seeded value in `sourceValues`. If
 *              present, wraps it as `ready`; if absent, produces an error.
 *
 * Cyclic nodes (those that `topoSort` could not order) receive an error
 * result rather than being silently dropped.
 *
 * The caller (service layer) is responsible for executing source
 * providers asynchronously and passing the results in `sourceValues`.
 */
export function evaluate(
  dag: DAG,
  sourceValues: ReadonlyMap<NodeId, unknown>,
): ReadonlyMap<NodeId, ResolveResult> {
  const results = new Map<NodeId, ResolveResult>();
  const topo = topoSort(dag);

  // Evaluate every node that the topo sort could order.
  const ordered =
    topo.kind === "sorted" ? topo.order : topo.sortedPrefix;

  for (const nodeId of ordered) {
    const node = dag.nodes.get(nodeId)!;
    results.set(nodeId, resolveNode(node, results, sourceValues));
  }

  // Cyclic nodes get an error result.
  if (topo.kind === "unsortable") {
    for (const nodeId of topo.remaining) {
      results.set(nodeId, {
        kind: "error",
        error: { message: `cycle: node "${nodeId}" participates in a dependency cycle`, cause: null },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------

import type { DAGNode } from "./types.js";

function resolveNode(
  node: DAGNode,
  results: ReadonlyMap<NodeId, ResolveResult>,
  sourceValues: ReadonlyMap<NodeId, unknown>,
): ResolveResult {
  switch (node.field.kind) {
    case "static":
      return { kind: "ready", value: node.field.value };

    case "ref": {
      // The target was already evaluated (topo order guarantees this).
      const targetId = targetNodeId(node);
      if (!targetId) {
        return {
          kind: "error",
          error: { message: `ref resolution failed for "${node.id}"`, cause: null },
        };
      }
      const target = results.get(targetId);
      if (!target) {
        return {
          kind: "error",
          error: { message: `unknown target "${targetId}"`, cause: null },
        };
      }
      if (target.kind === "error") {
        return {
          kind: "error",
          error: {
            message: `ref "${node.id}" depends on a failed node`,
            cause: target.error,
          },
        };
      }
      return { kind: "ready", value: target.value };
    }

    case "source": {
      const seeded = sourceValues.get(node.id);
      if (seeded === undefined) {
        return {
          kind: "error",
          error: { message: `no value seeded for source "${node.id}" (provider: ${node.field.source})`, cause: null },
        };
      }
      return { kind: "ready", value: seeded };
    }
  }
}

// Resolve the ref's target NodeId from the DAG's dependency index.
// A ref node has exactly one dependency — the target it points to.
import { resolveRef } from "../codoc/ref.js";

function targetNodeId(node: DAGNode): NodeId | null {
  if (node.field.kind !== "ref") return null;
  return resolveRef(node.field.ref, node.codocPath);
}
