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
 * Only keys present in `update` trigger a merge. Keys whose value
 * is `undefined` in the update are skipped (treated as "no change").
 */
export function mergeState<S>(
  prev: S,
  update: Partial<S>,
  reducers: StateReducers<S>,
): S {
  const result = { ...prev };
  for (const key of Object.keys(update) as Array<keyof S>) {
    const incoming = update[key];
    if (incoming === undefined) continue;
    const reducer = reducers[key];
    if (reducer) {
      result[key] = reducer(prev[key], incoming as S[keyof S]);
    } else {
      result[key] = incoming as S[keyof S];
    }
  }
  return result;
}
