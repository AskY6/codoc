// list-agents — return every registered agent listing.

import type { ServiceCtx } from "../../context.js";
import { agentRepo } from "../../repo/agent.js";
import type { AgentListItem } from "../../types/agent.js";

export type ListAgentsError = never;

export async function listAgents(
  ctx: ServiceCtx,
): Promise<readonly AgentListItem[]> {
  return agentRepo.list(ctx);
}
