// Thin facade over `Storage.workspaceAgents`.

import type { AgentId, Result, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { ServiceCtx } from "../context.js";
import type { AgentNotFound, WorkspaceNotFound } from "../errors.js";

export const workspaceAgentRepo = {
  async link(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
    agentId: AgentId,
  ): Promise<Result<void, WorkspaceNotFound | AgentNotFound>> {
    const r = await ctx.storage.workspaceAgents.link(ctx.storageCtx, {
      workspaceId,
      agentId,
    });
    if (!r.ok) {
      if (r.error.kind === "workspace-not-found") {
        return err({ kind: "workspace-not-found", id: workspaceId });
      }
      return err({ kind: "agent-not-found", id: agentId });
    }
    return ok(undefined);
  },

  async unlink(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
    agentId: AgentId,
  ): Promise<void> {
    await ctx.storage.workspaceAgents.unlink(ctx.storageCtx, {
      workspaceId,
      agentId,
    });
  },

  async listByWorkspace(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
  ): Promise<readonly AgentId[]> {
    const rows = await ctx.storage.workspaceAgents.listByWorkspace(
      ctx.storageCtx,
      workspaceId,
    );
    return rows.map((r) => r.link.agentId);
  },

  async countByWorkspace(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
  ): Promise<number> {
    const rows = await ctx.storage.workspaceAgents.listByWorkspace(
      ctx.storageCtx,
      workspaceId,
    );
    return rows.length;
  },
};
