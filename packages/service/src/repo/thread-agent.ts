// Thin facade over `Storage.threadAgents`.

import type { AgentId, Result, ThreadId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { ServiceCtx } from "../context.js";
import type { AgentNotFound, ThreadNotFound } from "../errors.js";

export const threadAgentRepo = {
  async link(
    ctx: ServiceCtx,
    threadId: ThreadId,
    agentId: AgentId,
  ): Promise<Result<void, ThreadNotFound | AgentNotFound>> {
    const r = await ctx.storage.threadAgents.link(ctx.storageCtx, {
      threadId,
      agentId,
    });
    if (!r.ok) {
      if (r.error.kind === "thread-not-found") {
        return err({ kind: "thread-not-found", id: threadId });
      }
      return err({ kind: "agent-not-found", id: agentId });
    }
    return ok(undefined);
  },

  async unlink(
    ctx: ServiceCtx,
    threadId: ThreadId,
    agentId: AgentId,
  ): Promise<void> {
    await ctx.storage.threadAgents.unlink(ctx.storageCtx, {
      threadId,
      agentId,
    });
  },

  async listByThread(
    ctx: ServiceCtx,
    threadId: ThreadId,
  ): Promise<readonly AgentId[]> {
    const rows = await ctx.storage.threadAgents.listByThread(
      ctx.storageCtx,
      threadId,
    );
    return rows.map((r) => r.link.agentId);
  },
};
