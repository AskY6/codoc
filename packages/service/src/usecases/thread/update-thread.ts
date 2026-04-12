// update-thread — update a thread's mutable fields (title) with
// optimistic concurrency.
//
// Used by auto-title (fire-and-forget after first assistant response)
// and future manual renames. Single-store write; no transaction needed.

import type { ChatThread, Result, ThreadId } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { ThreadConflict, ThreadNotFound } from "../../errors.js";
import { threadRepo } from "../../repo/thread.js";
import type { ThreadListItem } from "../../types/thread.js";

export interface UpdateThreadInput {
  readonly id: ThreadId;
  readonly title: string | null;
  readonly expectedRev: string;
}

export type UpdateThreadError = ThreadNotFound | ThreadConflict;

export async function updateThread(
  ctx: ServiceCtx,
  input: UpdateThreadInput,
): Promise<Result<ThreadListItem, UpdateThreadError>> {
  // Read current thread to preserve immutable fields (workspaceId).
  const current = await threadRepo.get(ctx, input.id);
  if (!current.ok) return current;

  const thread: ChatThread = {
    id: input.id,
    workspaceId: current.value.thread.workspaceId,
    title: input.title,
  };
  return threadRepo.update(ctx, {
    thread,
    expectedRev: input.expectedRev,
  });
}
