/**
 * A reducer for a single state field. Combines the previous value
 * with the incoming value produced by a node. The "last write wins"
 * strategy is `(_, incoming) => incoming`; "append" on an array is
 * `(prev, incoming) => [...prev, ...incoming]`; etc.
 */
export type FieldReducer<T> = (prev: T, incoming: T) => T;

/**
 * Optional per-field reducer table. Fields that do not appear here
 * fall back to "last write wins". The executor consults this table
 * when merging a node's `Partial<S>` return value back into the
 * running state.
 */
export type StateReducers<S> = {
  readonly [K in keyof S]?: FieldReducer<S[K]>;
};

/**
 * Merge a node's partial update into the current state, honouring
 * any per-field reducer. Pure.
 *
 * Skeleton implementation — see `graph/AGENTS.md` for the contract.
 */
export declare function mergeState<S>(
  prev: S,
  update: Partial<S>,
  reducers: StateReducers<S>,
): S;
