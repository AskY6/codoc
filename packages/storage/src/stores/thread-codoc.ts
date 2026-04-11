import type {
  CodocId,
  Result,
  ThreadCodoc,
  ThreadId,
} from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { NotFound, ThreadCodocWorkspaceMismatch } from "../errors.js";
import type { StoredThreadCodoc } from "../stored.js";

/**
 * Thread ↔ codoc link store.
 *
 * `link` enforces the workspace invariant: the thread and the codoc
 * must belong to the same workspace. The check lives on the store
 * (not in service code) so callers cannot forget it.
 *
 * Both `link` and `unlink` are idempotent:
 *   - linking an already-linked `(threadId, codocId)` pair returns
 *     the existing row rather than erroring
 *   - unlinking a non-existent pair succeeds silently
 *
 * `listByCodoc` is the lookup used by `CodocStore.delete` to decide
 * whether a codoc is still referenced.
 */
export interface ThreadCodocStore {
  link(
    ctx: Ctx,
    link: ThreadCodoc,
  ): Promise<
    Result<
      StoredThreadCodoc,
      NotFound<"thread"> | NotFound<"codoc"> | ThreadCodocWorkspaceMismatch
    >
  >;

  unlink(ctx: Ctx, link: ThreadCodoc): Promise<void>;

  listByThread(
    ctx: Ctx,
    threadId: ThreadId,
  ): Promise<readonly StoredThreadCodoc[]>;

  listByCodoc(
    ctx: Ctx,
    codocId: CodocId,
  ): Promise<readonly StoredThreadCodoc[]>;
}
