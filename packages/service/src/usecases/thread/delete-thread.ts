// delete-thread — remove a thread by id.
//
// The storage layer deletes the thread and its entire message log
// atomically; no service-side cascade needed. Single-store call,
// no transaction.

import type { Result, ThreadId } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { ThreadNotFound } from "../../errors.js";
import { threadRepo } from "../../repo/thread.js";

export type DeleteThreadError = ThreadNotFound;

export async function deleteThread(
  ctx: ServiceCtx,
  id: ThreadId,
): Promise<Result<void, DeleteThreadError>> {
  return threadRepo.delete(ctx, id);
}
