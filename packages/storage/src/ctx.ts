// Ctx — opaque transaction context threaded through every Store method.
//
// Service code never inspects a Ctx. It either takes the default
// auto-commit ctx from `Storage.ctx()` for single-step operations, or
// obtains a transactional ctx from `Storage.withTransaction` for
// composite actions that must be atomic.
//
// Concrete Storage implementations extend this interface with their
// own internal handle (a SQLite transaction, an in-memory snapshot,
// etc.) and keep that state private.

export interface Ctx {
  /** @internal — opaque brand; do not read or write from service code. */
  readonly __brand: "StorageCtx";
}
