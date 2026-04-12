// set-thread-codocs — reconcile the set of codocs pinned into a thread.

import type { CodocId, Result, ThreadId } from "@cobook/core";
import { ok } from "@cobook/core";
import type { TxAborted } from "@cobook/storage";
import type { ServiceCtx } from "../../context.js";
import { withStorageCtx } from "../../context.js";
import type {
  CodocNotFound,
  ThreadCodocWorkspaceMismatch,
  ThreadNotFound,
} from "../../errors.js";
import { threadCodocRepo } from "../../repo/thread-codoc.js";

export interface SetThreadCodocsInput {
  readonly threadId: ThreadId;
  readonly codocIds: readonly CodocId[];
}

export type SetThreadCodocsError =
  | ThreadNotFound
  | CodocNotFound
  | ThreadCodocWorkspaceMismatch
  | TxAborted;

export async function setThreadCodocs(
  ctx: ServiceCtx,
  input: SetThreadCodocsInput,
): Promise<Result<readonly CodocId[], SetThreadCodocsError>> {
  return ctx.storage.withTransaction(async (storageCtx) => {
    const txCtx = withStorageCtx(ctx, storageCtx);
    const current = await threadCodocRepo.listByThread(txCtx, input.threadId);
    const desired = new Set(input.codocIds);
    const currentSet = new Set(current);

    const toLink = input.codocIds.filter((id) => !currentSet.has(id));
    const toUnlink = current.filter((id) => !desired.has(id));

    for (const codocId of toUnlink) {
      await threadCodocRepo.unlink(txCtx, input.threadId, codocId);
    }
    for (const codocId of toLink) {
      const r = await threadCodocRepo.link(txCtx, input.threadId, codocId);
      if (!r.ok) return r;
    }

    return ok(await threadCodocRepo.listByThread(txCtx, input.threadId));
  });
}
