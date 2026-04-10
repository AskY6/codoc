import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { edges } from "../schema.js";
import type { Edge, EdgeRepository } from "./types.js";

export function createEdgeRepository(db: DbExecutor): EdgeRepository {
  return {
    async replaceAll(workspaceId, newEdges) {
      // delete + insert on the caller's executor. If `db` is a tx handle the
      // caller is already inside a transaction and this pair will roll back
      // together with the outer tx. If `db` is a top-level Database the
      // service layer should wrap replaceAll in withTx to keep the two
      // statements atomic.
      await db.delete(edges).where(eq(edges.workspaceId, workspaceId));
      if (newEdges.length > 0) {
        await db.insert(edges).values(
          newEdges.map((e) => ({
            workspaceId,
            fromNodeId: e.fromNodeId,
            toNodeId: e.toNodeId,
          })),
        );
      }
    },

    async listByWorkspace(workspaceId) {
      return (await db
        .select()
        .from(edges)
        .where(eq(edges.workspaceId, workspaceId))) as Edge[];
    },
  };
}
