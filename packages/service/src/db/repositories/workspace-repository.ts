import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { workspaces } from "../schema.js";
import type { Workspace, WorkspaceRepository } from "./types.js";

export function createWorkspaceRepository(db: Database): WorkspaceRepository {
  return {
    async create(data) {
      const [row] = await db
        .insert(workspaces)
        .values({ name: data.name, rootPath: data.rootPath })
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

    async findByPath(rootPath) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.rootPath, rootPath));
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
