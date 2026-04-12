import type { Workspace, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  Rev,
  StoredWorkspace,
  Timestamp,
  UpdateWorkspaceInput,
  WorkspaceStore,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { isUniqueViolation } from "../pg-error.js";
import { workspaces } from "../schema.js";

interface Deps {
  readonly clock: Clock;
}

interface Row {
  id: string;
  name: string;
  description: string | null;
  rev: string;
  createdAt: number;
  updatedAt: number;
}

function toStored(row: Row): StoredWorkspace {
  return {
    workspace: {
      id: row.id as WorkspaceId,
      name: row.name,
      description: row.description,
    },
    rev: row.rev as Rev,
    createdAt: row.createdAt as Timestamp,
    updatedAt: row.updatedAt as Timestamp,
  };
}

export function createPgWorkspaceStore(deps: Deps): WorkspaceStore {
  return {
    async get(ctx: Ctx, id: WorkspaceId) {
      const db = pgDb(ctx);
      const row = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id as string))
        .then((r) => r[0]);
      if (!row) return err({ kind: "workspace-not-found" as const });
      return ok(toStored(row));
    },

    async list(ctx: Ctx) {
      const db = pgDb(ctx);
      const rows = await db.select().from(workspaces);
      return rows.map(toStored);
    },

    async create(ctx: Ctx, workspace: Workspace) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const rev = crypto.randomUUID() as Rev;
      try {
        const row = await db
          .insert(workspaces)
          .values({
            id: workspace.id as string,
            name: workspace.name,
            description: workspace.description,
            rev: rev as string,
            createdAt: now as number,
            updatedAt: now as number,
          })
          .returning()
          .then((r) => r[0]!);
        return ok(toStored(row));
      } catch (e) {
        if (isUniqueViolation(e))
          return err({ kind: "workspace-already-exists" as const });
        throw e;
      }
    },

    async update(ctx: Ctx, input: UpdateWorkspaceInput) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const newRev = crypto.randomUUID() as Rev;
      const { workspace, expectedRev } = input;

      const rows = await db
        .update(workspaces)
        .set({
          name: workspace.name,
          description: workspace.description,
          rev: newRev as string,
          updatedAt: now as number,
        })
        .where(
          and(
            eq(workspaces.id, workspace.id as string),
            eq(workspaces.rev, expectedRev as string),
          )!,
        )
        .returning();

      if (rows.length === 0) {
        const existing = await db
          .select({ rev: workspaces.rev })
          .from(workspaces)
          .where(eq(workspaces.id, workspace.id as string))
          .then((r) => r[0]);
        if (!existing) return err({ kind: "workspace-not-found" as const });
        return err({
          kind: "workspace-conflict" as const,
          currentRev: existing.rev as Rev,
        });
      }

      return ok(toStored(rows[0]!));
    },

    async delete(ctx: Ctx, id: WorkspaceId) {
      const db = pgDb(ctx);
      const rows = await db
        .delete(workspaces)
        .where(eq(workspaces.id, id as string))
        .returning({ id: workspaces.id });
      if (rows.length === 0)
        return err({ kind: "workspace-not-found" as const });
      return ok(undefined);
    },
  };
}
