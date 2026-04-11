import type { NodeId } from "./ids.js";

/**
 * A single branch of a conditional edge. Each branch owns a
 * predicate over the current state and the node id to transition to
 * if the predicate holds. Branches are evaluated in order; the
 * first matching branch wins.
 */
export interface ConditionalBranch<S> {
  readonly when: (state: S) => boolean;
  readonly to: NodeId;
}

/**
 * Graph edge ADT.
 *
 * - `static`: unconditional transition `from → to`.
 * - `conditional`: after `from`, evaluate `branches` and jump to the
 *   first match. If no branch matches, the graph is treated as
 *   ending (see `executor.ts`); downstream subtrees may require an
 *   explicit default branch that points at `END`.
 *
 * Cycles are **not supported at this stage**: the executor rejects
 * any graph whose edge set admits a back-edge to an already-visited
 * node. See `graph.ts` for the validation hook.
 */
export type Edge<S> =
  | {
      readonly kind: "static";
      readonly from: NodeId;
      readonly to: NodeId;
    }
  | {
      readonly kind: "conditional";
      readonly from: NodeId;
      readonly branches: readonly ConditionalBranch<S>[];
    };
