// create-thread — mint a fresh chat thread under a workspace.
//
// Use case owns the id: transports supply `{ workspaceId, title }`
// and the service mints the `ThreadId` via `ctx.idGen.threadId()`.
// Letting an untrusted client choose its own primary key is a
// security hazard — see `../AGENTS.md`.
//
// Slice 4 creates threads with a null title by default; the first
// user message is what gives a thread its identity in the UI. A
// later slice that adds "auto-title from first message" will do so
// on append, not on create.

import type {
  ChatThread,
  Result,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type {
  ThreadAlreadyExists,
  WorkspaceNotFound,
} from "../../errors.js";
import { threadRepo } from "../../repo/thread.js";
import type { ThreadListItem } from "../../types/thread.js";

export interface CreateThreadInput {
  readonly workspaceId: WorkspaceId;
  readonly title: string | null;
}

export type CreateThreadError = ThreadAlreadyExists | WorkspaceNotFound;

export async function createThread(
  ctx: ServiceCtx,
  input: CreateThreadInput,
): Promise<Result<ThreadListItem, CreateThreadError>> {
  const id: ThreadId = ctx.idGen.threadId();
  const thread: ChatThread = {
    id,
    workspaceId: input.workspaceId,
    title: input.title,
  };
  return threadRepo.create(ctx, thread);
}
