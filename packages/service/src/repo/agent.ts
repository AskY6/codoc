// Thin facade over `Storage.agents`.

import type { AgentId, Result } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { StoredAgent } from "@cobook/storage";
import type { ServiceCtx } from "../context.js";
import type { AgentNotFound } from "../errors.js";
import type { AgentListItem } from "../types/agent.js";

function toListItem(row: StoredAgent): AgentListItem {
  return {
    listing: row.listing,
    createdAt: row.createdAt as number,
  };
}

export const agentRepo = {
  async get(
    ctx: ServiceCtx,
    id: AgentId,
  ): Promise<Result<AgentListItem, AgentNotFound>> {
    const r = await ctx.storage.agents.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "agent-not-found", id });
    return ok(toListItem(r.value));
  },

  async list(ctx: ServiceCtx): Promise<readonly AgentListItem[]> {
    const rows = await ctx.storage.agents.list(ctx.storageCtx);
    return rows.map(toListItem);
  },
};
