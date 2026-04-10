import type { CodocId, NodeId } from "./ids.js";

/**
 * Recursive error shape for resolve failures. A nested `cause` lets the
 * resolver record the upstream failure that triggered this one without
 * pulling in any exception / framework type.
 */
export interface ResolveError {
  readonly message: string;
  readonly cause: ResolveError | null;
}

/**
 * Outcome of resolving a single DAG node.
 *
 * ADT — either we produced a value, or we produced an error. The legacy
 * shape (`state: "ready" | "error"` alongside a single `value: unknown`)
 * allowed illegal combinations; this eliminates them.
 */
export type ResolveResult =
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "error"; readonly error: ResolveError };

/**
 * The materialised result of a single field-level node.
 *
 * No surrogate id, no workspaceId, no timestamps — those are storage
 * concerns that belong outside core.
 */
export interface ResolvedField {
  readonly codocId: CodocId;
  readonly nodeId: NodeId;
  readonly result: ResolveResult;
}
