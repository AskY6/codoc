import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { workspaces } from "../schema.js";
import type { Workspace, WorkspaceRepository } from "./types.js";

export function createWorkspaceRepository(db: Database): WorkspaceRepository {
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

    async delete(id) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    },
  };
}
