// Thin facade over `Storage.threads`.
//
// Same shape as `workspaceRepo` / `codocRepo`: forwards to one store,
// peels `StoredChatThread` / `StoredChatMessage` envelopes into
// UI-shaped DTOs, and maps storage error variants to service
// variants. See `./AGENTS.md`.

import type {
  ChatMessage,
  ChatThread,
  Result,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { StoredChatMessage, StoredChatThread } from "@cobook/storage";
import type { ServiceCtx } from "../context.js";
import type {
  MessageAlreadyExists,
  ThreadAlreadyExists,
  ThreadNotFound,
  WorkspaceNotFound,
} from "../errors.js";
import type { ThreadListItem, ThreadMessage } from "../types/thread.js";

function toListItem(row: StoredChatThread): ThreadListItem {
  return {
    thread: row.thread,
    updatedAt: row.updatedAt as number,
    rev: row.rev as string,
  };
}

function toMessage(row: StoredChatMessage): ThreadMessage {
  return {
    message: row.message,
    seq: row.seq,
    createdAt: row.createdAt as number,
  };
}

export const threadRepo = {
  async get(
    ctx: ServiceCtx,
    id: ThreadId,
  ): Promise<Result<ThreadListItem, ThreadNotFound>> {
    const r = await ctx.storage.threads.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "thread-not-found", id });
    return ok(toListItem(r.value));
  },

  async listByWorkspace(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
  ): Promise<readonly ThreadListItem[]> {
    const rows = await ctx.storage.threads.listByWorkspace(
      ctx.storageCtx,
      workspaceId,
    );
    return rows.map(toListItem);
  },

  async listMessages(
    ctx: ServiceCtx,
    threadId: ThreadId,
  ): Promise<readonly ThreadMessage[]> {
    const rows = await ctx.storage.threads.listMessages(
      ctx.storageCtx,
      threadId,
    );
    return rows.map(toMessage);
  },

  async create(
    ctx: ServiceCtx,
    thread: ChatThread,
  ): Promise<
    Result<ThreadListItem, ThreadAlreadyExists | WorkspaceNotFound>
  > {
    const r = await ctx.storage.threads.create(ctx.storageCtx, thread);
    if (!r.ok) {
      if (r.error.kind === "workspace-not-found") {
        return err({ kind: "workspace-not-found", id: thread.workspaceId });
      }
      return err({ kind: "thread-already-exists", id: thread.id });
    }
    return ok(toListItem(r.value));
  },

  async delete(
    ctx: ServiceCtx,
    id: ThreadId,
  ): Promise<Result<void, ThreadNotFound>> {
    const r = await ctx.storage.threads.delete(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "thread-not-found", id });
    return ok(undefined);
  },

  async appendMessage(
    ctx: ServiceCtx,
    message: ChatMessage,
  ): Promise<Result<ThreadMessage, ThreadNotFound | MessageAlreadyExists>> {
    const r = await ctx.storage.threads.appendMessage(
      ctx.storageCtx,
      message,
    );
    if (!r.ok) {
      if (r.error.kind === "thread-not-found") {
        return err({ kind: "thread-not-found", id: message.threadId });
      }
      return err({ kind: "message-already-exists", id: message.id });
    }
    return ok(toMessage(r.value));
  },
};
