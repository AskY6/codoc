import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { codocs } from "../schema.js";
import type { Codoc, CodocRepository } from "./types.js";

export function createCodocRepository(db: DbExecutor): CodocRepository {
  return {
    async upsert(workspaceId, path, data) {
      const [row] = await db
        .insert(codocs)
        .values({
          workspaceId,
          path,
          content: data.content ?? "",
        })
        .onConflictDoUpdate({
          target: [codocs.workspaceId, codocs.path],
          set: {
            ...(data.content !== undefined && { content: data.content }),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row as Codoc;
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(codocs)
        .where(eq(codocs.id, id));
      return row as Codoc | undefined;
    },

    async findByPath(workspaceId, path) {
      const [row] = await db
        .select()
        .from(codocs)
        .where(and(eq(codocs.workspaceId, workspaceId), eq(codocs.path, path)));
      return row as Codoc | undefined;
    },

    async listByWorkspace(workspaceId) {
      return (await db
        .select()
        .from(codocs)
        .where(eq(codocs.workspaceId, workspaceId))) as Codoc[];
    },

    async delete(workspaceId, path) {
      await db
        .delete(codocs)
        .where(and(eq(codocs.workspaceId, workspaceId), eq(codocs.path, path)));
    },
  };
}
