import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { workspaces, codocs, workspaceAgents } from "../schema.js";
import type { Workspace, WorkspaceListItem, WorkspaceRepository } from "./types.js";

export function createWorkspaceRepository(db: DbExecutor): WorkspaceRepository {
  return {
    async create(data) {
      const [row] = await db
        .insert(workspaces)
        .values({ name: data.name, description: data.description })
        .returning();
      return row as Workspace;
    },

    async update(id, data) {
      const [row] = await db
        .update(workspaces)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workspaces.id, id))
        .returning();
      return row as Workspace;
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id));
      return row as Workspace | undefined;
    },

    async list() {
      return (await db.select().from(workspaces)) as Workspace[];
    },

    async listWithStats() {
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          description: workspaces.description,
          createdAt: workspaces.createdAt,
          updatedAt: workspaces.updatedAt,
          codocCount: sql<number>`coalesce(count(distinct ${codocs.id}), 0)::int`,
          agentCount: sql<number>`coalesce(count(distinct ${workspaceAgents.id}), 0)::int`,
        })
        .from(workspaces)
        .leftJoin(codocs, eq(codocs.workspaceId, workspaces.id))
        .leftJoin(workspaceAgents, eq(workspaceAgents.workspaceId, workspaces.id))
        .groupBy(workspaces.id);
      return rows as WorkspaceListItem[];
    },

    async delete(id) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    },
  };
}
