// Storage-layer error ADTs.
//
// Every Store method returns Result<T, E> where E is a union of the
// variants in this file. Services pattern-match on `kind` to decide
// how to surface the failure; error values carry enough context
// (currentRev, referrers, …) to let callers render a meaningful UI.

import type { ThreadId, WorkspaceId } from "@cobook/core";
import type { Rev } from "./meta.js";

/** A row requested by id does not exist. */
export type NotFound<K extends string> = {
  readonly kind: `${K}-not-found`;
};

/**
 * A row with the requested id already exists. Returned by `create`
 * methods when the caller's fresh id collides with an existing row.
 */
export type AlreadyExists<K extends string> = {
  readonly kind: `${K}-already-exists`;
};

/**
 * Optimistic concurrency failure: the caller's `expectedRev` no longer
 * matches the stored row. `currentRev` is the Rev the store currently
 * holds, which the caller may use to refetch and retry.
 */
export type Conflict<K extends string> = {
  readonly kind: `${K}-conflict`;
  readonly currentRev: Rev;
};

/**
 * Codoc delete was refused because one or more threads still link it.
 * Callers must unlink from every listed thread before retrying.
 */
export type CodocReferenced = {
  readonly kind: "codoc-referenced";
  readonly byThreads: readonly ThreadId[];
};

/**
 * A thread and a codoc cannot be linked because they belong to
 * different workspaces. Cross-workspace linking is disallowed.
 */
export type ThreadCodocWorkspaceMismatch = {
  readonly kind: "thread-codoc-workspace-mismatch";
  readonly threadWorkspaceId: WorkspaceId;
  readonly codocWorkspaceId: WorkspaceId;
};

/**
 * The enclosing `withTransaction` call could not commit. The inner
 * function's own `err(...)` values are returned as-is; `TxAborted`
 * only appears when the store itself fails to commit (disk error,
 * constraint violation surfaced at commit, etc.).
 */
export type TxAborted = {
  readonly kind: "tx-aborted";
  readonly cause: unknown;
};
