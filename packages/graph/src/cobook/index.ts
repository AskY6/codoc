// cobook/ — graph specialization for the cobook runtime. The only
// subtree allowed to import cobook-flavoured types from @cobook/core.
//
// Planned future split: this subtree is expected to move out of
// @cobook/graph once boundaries stabilise. Do not deepen its
// coupling with ../graph/ beyond what the current types require.

export type { CobookState } from "./state.js";
export type { CobookEvent } from "./events.js";
export { cobookReducers } from "./reducers.js";
