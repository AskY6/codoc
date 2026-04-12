// Thin facade over `Storage.threadCodocs`.

import type { CodocId, Result, ThreadId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { ServiceCtx } from "../context.js";
import type {
  CodocNotFound,
  ThreadCodocWorkspaceMismatch,
  ThreadNotFound,
} from "../errors.js";

export const threadCodocRepo = {
  async link(
    ctx: ServiceCtx,
    threadId: ThreadId,
    codocId: CodocId,
  ): Promise<
    Result<void, ThreadNotFound | CodocNotFound | ThreadCodocWorkspaceMismatch>
  > {
    const r = await ctx.storage.threadCodocs.link(ctx.storageCtx, {
      threadId,
      codocId,
    });
    if (!r.ok) {
      if (r.error.kind === "thread-not-found") {
        return err({ kind: "thread-not-found", id: threadId });
      }
      if (r.error.kind === "codoc-not-found") {
        return err({ kind: "codoc-not-found", id: codocId });
      }
      return err(r.error);
    }
    return ok(undefined);
  },

  async unlink(
    ctx: ServiceCtx,
    threadId: ThreadId,
    codocId: CodocId,
  ): Promise<void> {
    await ctx.storage.threadCodocs.unlink(ctx.storageCtx, {
      threadId,
      codocId,
    });
  },

  async listByThread(
    ctx: ServiceCtx,
    threadId: ThreadId,
  ): Promise<readonly CodocId[]> {
    const rows = await ctx.storage.threadCodocs.listByThread(
      ctx.storageCtx,
      threadId,
    );
    return rows.map((r) => r.link.codocId);
  },
};
