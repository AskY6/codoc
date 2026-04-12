import type { Result } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { Graph } from "./graph.js";
import { END, type NodeId } from "./ids.js";
import type { NodeContext } from "./node.js";
import { mergeState } from "./state.js";

/**
 * Knobs the caller of `runGraph` can turn.
 *
 * - `maxSteps`: safety cap on the number of node transitions per run.
 *   Defaults to 50.
 * - `signal`: external cancellation. Forwarded into every
 *   `NodeContext.signal`.
 */
export interface ExecutorOptions {
  readonly maxSteps?: number;
  readonly signal?: AbortSignal;
}

/**
 * Outcome of a successful `runGraph` call.
 *
 * `reachedEnd` is `true` iff the last transition landed on `END`.
 * `steps` counts how many nodes were entered (not how many edges
 * were traversed).
 */
export interface ExecutionResult<S> {
  readonly state: S;
  readonly reachedEnd: boolean;
  readonly steps: number;
  readonly lastNodeId: NodeId;
}

/**
 * Structured errors the executor may return.
 */
export type RunGraphError =
  | { readonly kind: "maxStepsExceeded"; readonly lastNodeId: NodeId }
  | { readonly kind: "noMatchingBranch"; readonly at: NodeId }
  | { readonly kind: "nodeThrew"; readonly at: NodeId; readonly cause: unknown }
  | { readonly kind: "aborted"; readonly at: NodeId };

const DEFAULT_MAX_STEPS = 50;

/**
 * Run a graph to completion. Events emitted by nodes are piped
 * through `ctx.emit` synchronously in the order they were emitted.
 * On success returns the final state; on structured failure returns
 * a `RunGraphError` variant.
 */
export async function runGraph<S, E>(
  graph: Graph<S, E>,
  initialState: S,
  ctx: NodeContext<E>,
  options?: ExecutorOptions,
): Promise<Result<ExecutionResult<S>, RunGraphError>> {
  const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
  const signal = options?.signal ?? ctx.signal;

  let state = initialState;
  let currentNodeId: NodeId = graph.entry;
  let steps = 0;

  // Build edge lookup: from → Edge<S>
  const edgeMap = new Map<NodeId, (typeof graph.edges)[number]>();
  for (const edge of graph.edges) {
    edgeMap.set(edge.from, edge);
  }

  while (currentNodeId !== END) {
    if (steps >= maxSteps) {
      return err({ kind: "maxStepsExceeded", lastNodeId: currentNodeId });
    }
    if (signal.aborted) {
      return err({ kind: "aborted", at: currentNodeId });
    }

    const node = graph.nodes.get(currentNodeId);
    if (!node) {
      // Should never happen for a valid graph, but guard anyway.
      return err({ kind: "noMatchingBranch", at: currentNodeId });
    }

    // Run the node.
    let partial: Partial<S>;
    try {
      partial = await node.run(state, ctx);
    } catch (cause) {
      return err({ kind: "nodeThrew", at: currentNodeId, cause });
    }

    // Merge the update.
    state = mergeState(state, partial, graph.reducers);
    steps++;

    // Resolve the next node via the edge.
    const edge = edgeMap.get(currentNodeId);
    if (!edge) {
      // No edge from this node → treat as reaching end.
      return ok({
        state,
        reachedEnd: false,
        steps,
        lastNodeId: currentNodeId,
      });
    }

    if (edge.kind === "static") {
      currentNodeId = edge.to;
    } else {
      // Conditional: evaluate branches in order, first match wins.
      let matched = false;
      for (const branch of edge.branches) {
        if (branch.when(state)) {
          currentNodeId = branch.to;
          matched = true;
          break;
        }
      }
      if (!matched) {
        return err({ kind: "noMatchingBranch", at: currentNodeId });
      }
    }
  }

  return ok({
    state,
    reachedEnd: true,
    steps,
    lastNodeId: currentNodeId,
  });
}
