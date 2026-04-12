// list-workspace-agents — return the agent ids linked to a workspace.

import type { AgentId, WorkspaceId } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import { workspaceAgentRepo } from "../../repo/workspace-agent.js";

export type ListWorkspaceAgentsError = never;

export async function listWorkspaceAgents(
  ctx: ServiceCtx,
  workspaceId: WorkspaceId,
): Promise<readonly AgentId[]> {
  return workspaceAgentRepo.listByWorkspace(ctx, workspaceId);
}
