import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { edges } from "../schema.js";
import type { Edge, EdgeRepository } from "./types.js";

export function createEdgeRepository(db: Database): EdgeRepository {
  return {
    async replaceAll(workspaceId, newEdges) {
      await db.transaction(async (tx) => {
        await tx.delete(edges).where(eq(edges.workspaceId, workspaceId));

        if (newEdges.length > 0) {
          await tx.insert(edges).values(
            newEdges.map((e) => ({
              workspaceId,
              fromNodeId: e.fromNodeId,
              toNodeId: e.toNodeId,
            })),
          );
        }
      });
    },

    async listByWorkspace(workspaceId) {
      return (await db
        .select()
        .from(edges)
        .where(eq(edges.workspaceId, workspaceId))) as Edge[];
    },
  };
}
