import type { AgentId, WorkspaceAgent, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  StoredWorkspaceAgent,
  Timestamp,
  WorkspaceAgentStore,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { constraintName, isForeignKeyViolation } from "../pg-error.js";
import { workspaceAgents } from "../schema.js";

interface Deps {
  readonly clock: Clock;
}

function toStored(row: {
  workspaceId: string;
  agentId: string;
  createdAt: number;
}): StoredWorkspaceAgent {
  return {
    link: {
      workspaceId: row.workspaceId as WorkspaceId,
      agentId: row.agentId as AgentId,
    },
    createdAt: row.createdAt as Timestamp,
  };
}

export function createPgWorkspaceAgentStore(deps: Deps): WorkspaceAgentStore {
  return {
    async link(ctx: Ctx, link: WorkspaceAgent) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      try {
        const rows = await db
          .insert(workspaceAgents)
          .values({
            workspaceId: link.workspaceId as string,
            agentId: link.agentId as string,
            createdAt: now as number,
          })
          .onConflictDoNothing()
          .returning();

        if (rows.length > 0) return ok(toStored(rows[0]!));

        // Already exists — return existing row
        const existing = await db
          .select()
          .from(workspaceAgents)
          .where(
            and(
              eq(workspaceAgents.workspaceId, link.workspaceId as string),
              eq(workspaceAgents.agentId, link.agentId as string),
            ),
          )
          .then((r) => r[0]!);
        return ok(toStored(existing));
      } catch (e) {
        if (isForeignKeyViolation(e)) {
          const cn = constraintName(e) ?? "";
          if (cn.includes("agent_id"))
            return err({ kind: "agent-not-found" } as const);
          return err({ kind: "workspace-not-found" } as const);
        }
        throw e;
      }
    },

    async unlink(ctx: Ctx, link: WorkspaceAgent) {
      const db = pgDb(ctx);
      await db
        .delete(workspaceAgents)
        .where(
          and(
            eq(workspaceAgents.workspaceId, link.workspaceId as string),
            eq(workspaceAgents.agentId, link.agentId as string),
          ),
        );
    },

    async listByWorkspace(ctx: Ctx, workspaceId: WorkspaceId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(workspaceAgents)
        .where(eq(workspaceAgents.workspaceId, workspaceId as string));
      return rows.map(toStored);
    },

    async listByAgent(ctx: Ctx, agentId: AgentId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(workspaceAgents)
        .where(eq(workspaceAgents.agentId, agentId as string));
      return rows.map(toStored);
    },
  };
}
