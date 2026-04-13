// set-workspace-agents — reconcile the set of agents enabled in a workspace.
//
// Input is the desired set of agent ids. The use case diffs against
// the current set, links new ones, and unlinks removed ones. Runs
// inside a transaction so the read-then-write is atomic.

import type { Result, WorkspaceId } from "@cobook/core";
import { type AgentId, AgentId as makeAgentId, ok } from "@cobook/core";
import type { TxAborted } from "@cobook/storage";
import type { ServiceCtx } from "../../context.js";
import { withStorageCtx } from "../../context.js";
import type { AgentNotFound, WorkspaceNotFound } from "../../errors.js";
import { workspaceAgentRepo } from "../../repo/workspace-agent.js";

export interface SetWorkspaceAgentsInput {
  readonly workspaceId: WorkspaceId;
  readonly agentIds: readonly AgentId[];
}

export type SetWorkspaceAgentsError =
  | WorkspaceNotFound
  | AgentNotFound
  | TxAborted;

const BASE_AGENT_ID = makeAgentId("base");

export async function setWorkspaceAgents(
  ctx: ServiceCtx,
  input: SetWorkspaceAgentsInput,
): Promise<Result<readonly AgentId[], SetWorkspaceAgentsError>> {
  return ctx.storage.withTransaction(async (storageCtx) => {
    const txCtx = withStorageCtx(ctx, storageCtx);
    const current = await workspaceAgentRepo.listByWorkspace(
      txCtx,
      input.workspaceId,
    );
    // "base" agent is always required — ensure it cannot be removed.
    const desired = new Set(input.agentIds);
    desired.add(BASE_AGENT_ID);
    const currentSet = new Set(current);

    const toLink = input.agentIds.filter((id) => !currentSet.has(id));
    const toUnlink = current.filter((id) => !desired.has(id));

    for (const agentId of toUnlink) {
      await workspaceAgentRepo.unlink(txCtx, input.workspaceId, agentId);
    }
    for (const agentId of toLink) {
      const r = await workspaceAgentRepo.link(
        txCtx,
        input.workspaceId,
        agentId,
      );
      if (!r.ok) return r;
    }

    return ok(
      await workspaceAgentRepo.listByWorkspace(txCtx, input.workspaceId),
    );
  });
}
