import type { Clock, Ctx as StorageCtx, Storage } from "@cobook/storage";
import type { IdGenerator } from "./ports/id.js";

/**
 * Per-call environment for service use cases and repo modules.
 *
 * `storage` is the port itself — use cases call `storage.withTransaction`
 * when they need atomic multi-store composition. `storageCtx` is the
 * currently active storage `Ctx`: either the auto-commit ctx for
 * single-step actions, or the transaction ctx supplied by the caller
 * to `withTransaction`.
 *
 * `idGen` mints branded ids; use cases call `ctx.idGen.workspaceId()`
 * instead of touching `crypto.randomUUID()` directly.
 *
 * Repo methods must always use `ctx.storageCtx` — never call
 * `ctx.storage.ctx()` themselves — so that they transparently enroll in
 * whatever transaction the use case has opened above them.
 */
export interface ServiceCtx {
  readonly storage: Storage;
  readonly storageCtx: StorageCtx;
  readonly clock: Clock;
  readonly idGen: IdGenerator;
}

/**
 * Produce a fresh `ServiceCtx` that uses the given storage `Ctx`.
 *
 * Use cases call this when they open a transaction, passing the tx
 * handle supplied by `storage.withTransaction`, so that every repo /
 * storage call made inside the transaction reuses the same `Ctx`.
 */
export const withStorageCtx = (
  ctx: ServiceCtx,
  storageCtx: StorageCtx,
): ServiceCtx => ({
  storage: ctx.storage,
  storageCtx,
  clock: ctx.clock,
  idGen: ctx.idGen,
});
