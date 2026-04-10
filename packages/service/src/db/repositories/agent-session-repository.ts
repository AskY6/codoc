import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { agentSessions } from "../schema.js";
import type { AgentSession, AgentSessionRepository } from "./types.js";

export function createAgentSessionRepository(
  db: Database,
): AgentSessionRepository {
  return {
    async upsert(workspaceId, threadId, data) {
      const existing = await this.findByWorkspace(workspaceId);

      if (existing) {
        const [row] = await db
          .update(agentSessions)
          .set({
            threadId: threadId,
            ...(data.activeSceneId !== undefined && {
              activeSceneId: data.activeSceneId,
            }),
            ...(data.state !== undefined && { state: data.state }),
            updatedAt: new Date(),
          })
          .where(eq(agentSessions.id, existing.id))
          .returning();
        return row as AgentSession;
      }

      const [row] = await db
        .insert(agentSessions)
        .values({
          workspaceId,
          threadId,
          activeSceneId: data.activeSceneId ?? null,
          state: data.state ?? {},
        })
        .returning();
      return row as AgentSession;
    },

    async findByWorkspace(workspaceId) {
      const [row] = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.workspaceId, workspaceId));
      return row as AgentSession | undefined;
    },
  };
}
