import type { StateReducers } from "../graph/state.js";
import type { CobookState } from "./state.js";

/**
 * Canonical reducer table for `CobookState`.
 *
 * - `messages`: **append**. Every node that emits assistant / tool
 *   messages contributes by returning a `Partial<CobookState>` with
 *   a `messages` array of just the new messages; the reducer
 *   concatenates them onto the running history.
 * - `pinnedCodocs`: **append**. Same idea — nodes that pin a new
 *   codoc return only the new ids.
 * - Every other field (`workspaceId`, `threadId`, `activeAgent`)
 *   uses the default "last write wins" strategy, which means
 *   omitting them from this table is correct.
 *
 * Skeleton: implementation TBD. The shape here locks the contract
 * so downstream code can already reference it.
 */
export declare const cobookReducers: StateReducers<CobookState>;
