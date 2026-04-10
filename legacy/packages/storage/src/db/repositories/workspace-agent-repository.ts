import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { workspaceAgents } from "../schema.js";
import type { WorkspaceAgent, WorkspaceAgentRepository } from "./types.js";

export function createWorkspaceAgentRepository(
  db: DbExecutor,
): WorkspaceAgentRepository {
  return {
    async setForWorkspace(workspaceId, agentIds) {
      await db
        .delete(workspaceAgents)
        .where(eq(workspaceAgents.workspaceId, workspaceId));
      if (agentIds.length > 0) {
        await db
          .insert(workspaceAgents)
          .values(agentIds.map((agentId) => ({ workspaceId, agentId })));
      }
    },

    async listByWorkspace(workspaceId) {
      return (await db
        .select()
        .from(workspaceAgents)
        .where(
          eq(workspaceAgents.workspaceId, workspaceId),
        )) as WorkspaceAgent[];
    },
  };
}
