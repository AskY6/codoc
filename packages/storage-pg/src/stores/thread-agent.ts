import type { AgentId, ThreadAgent, ThreadId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  StoredThreadAgent,
  Timestamp,
  ThreadAgentStore,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { constraintName, isForeignKeyViolation } from "../pg-error.js";
import { threadAgents } from "../schema.js";

interface Deps {
  readonly clock: Clock;
}

function toStored(row: {
  threadId: string;
  agentId: string;
  createdAt: number;
}): StoredThreadAgent {
  return {
    link: {
      threadId: row.threadId as ThreadId,
      agentId: row.agentId as AgentId,
    },
    createdAt: row.createdAt as Timestamp,
  };
}

export function createPgThreadAgentStore(deps: Deps): ThreadAgentStore {
  return {
    async link(ctx: Ctx, link: ThreadAgent) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      try {
        const rows = await db
          .insert(threadAgents)
          .values({
            threadId: link.threadId as string,
            agentId: link.agentId as string,
            createdAt: now as number,
          })
          .onConflictDoNothing()
          .returning();

        if (rows.length > 0) return ok(toStored(rows[0]!));

        const existing = await db
          .select()
          .from(threadAgents)
          .where(
            and(
              eq(threadAgents.threadId, link.threadId as string),
              eq(threadAgents.agentId, link.agentId as string),
            ),
          )
          .then((r) => r[0]!);
        return ok(toStored(existing));
      } catch (e) {
        if (isForeignKeyViolation(e)) {
          const cn = constraintName(e) ?? "";
          if (cn.includes("agent_id"))
            return err({ kind: "agent-not-found" } as const);
          return err({ kind: "thread-not-found" } as const);
        }
        throw e;
      }
    },

    async unlink(ctx: Ctx, link: ThreadAgent) {
      const db = pgDb(ctx);
      await db
        .delete(threadAgents)
        .where(
          and(
            eq(threadAgents.threadId, link.threadId as string),
            eq(threadAgents.agentId, link.agentId as string),
          ),
        );
    },

    async listByThread(ctx: Ctx, threadId: ThreadId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(threadAgents)
        .where(eq(threadAgents.threadId, threadId as string));
      return rows.map(toStored);
    },

    async listByAgent(ctx: Ctx, agentId: AgentId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(threadAgents)
        .where(eq(threadAgents.agentId, agentId as string));
      return rows.map(toStored);
    },
  };
}
