// create-thread — mint a fresh chat thread under a workspace.
//
// Use case owns the id: transports supply `{ workspaceId, title }`
// and the service mints the `ThreadId` via `ctx.idGen.threadId()`.
// Letting an untrusted client choose its own primary key is a
// security hazard — see `../AGENTS.md`.
//
// After creating the thread, inherits the workspace's linked agents
// so the thread starts with the same agent set as the workspace.

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
import { threadAgentRepo } from "../../repo/thread-agent.js";
import { threadRepo } from "../../repo/thread.js";
import { workspaceAgentRepo } from "../../repo/workspace-agent.js";
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
  const result = await threadRepo.create(ctx, thread);
  if (!result.ok) return result;

  // Inherit workspace agents into the new thread.
  const wsAgentIds = await workspaceAgentRepo.listByWorkspace(
    ctx,
    input.workspaceId,
  );
  for (const agentId of wsAgentIds) {
    await threadAgentRepo.link(ctx, id, agentId);
  }

  return result;
}
