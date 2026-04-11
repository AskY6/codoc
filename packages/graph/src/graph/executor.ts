import type { Result } from "@cobook/core";
import type { Graph } from "./graph.js";
import type { NodeId } from "./ids.js";

/**
 * Knobs the caller of `runGraph` can turn.
 *
 * - `maxSteps`: safety cap on the number of node transitions per run.
 *   Defaults (to be decided in implementation) will be low enough
 *   that a misconfigured router cannot spin forever.
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
 * were traversed); the two differ when a conditional edge has no
 * matching branch.
 */
export interface ExecutionResult<S> {
  readonly state: S;
  readonly reachedEnd: boolean;
  readonly steps: number;
  readonly lastNodeId: NodeId;
}

/**
 * Structured errors the executor may return. IO failures originating
 * inside a node's `run` function are reflected as
 * `kind: "nodeThrew"` so callers do not need to catch.
 */
export type RunGraphError =
  | { readonly kind: "maxStepsExceeded"; readonly lastNodeId: NodeId }
  | { readonly kind: "noMatchingBranch"; readonly at: NodeId }
  | { readonly kind: "nodeThrew"; readonly at: NodeId; readonly cause: unknown }
  | { readonly kind: "aborted"; readonly at: NodeId };

/**
 * Run a graph to completion. Events emitted by nodes are piped to
 * `onEvent` synchronously in the order they were emitted. On
 * success returns the final state; on structured failure returns a
 * `RunGraphError` variant.
 *
 * Skeleton: implementation TBD.
 */
export declare function runGraph<S, E>(
  graph: Graph<S, E>,
  initialState: S,
  onEvent: (event: E) => void,
  options?: ExecutorOptions,
): Promise<Result<ExecutionResult<S>, RunGraphError>>;
