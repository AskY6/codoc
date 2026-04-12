import type {
  AgentSession,
  SessionId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AgentSessionStore,
  Clock,
  Ctx,
  Rev,
  StoredAgentSession,
  Timestamp,
  UpdateSessionInput,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import {
  constraintName,
  isForeignKeyViolation,
  isUniqueViolation,
} from "../pg-error.js";
import { agentSessions } from "../schema.js";

interface Deps {
  readonly clock: Clock;
}

function toStored(row: {
  id: string;
  workspaceId: string;
  threadId: string | null;
  activeSceneId: string | null;
  state: unknown;
  rev: string;
  createdAt: number;
  updatedAt: number;
}): StoredAgentSession {
  return {
    session: {
      id: row.id as SessionId,
      workspaceId: row.workspaceId as WorkspaceId,
      threadId: row.threadId as ThreadId | null,
      activeSceneId: row.activeSceneId,
      state: row.state as Readonly<Record<string, unknown>>,
    },
    rev: row.rev as Rev,
    createdAt: row.createdAt as Timestamp,
    updatedAt: row.updatedAt as Timestamp,
  };
}

export function createPgAgentSessionStore(deps: Deps): AgentSessionStore {
  return {
    async get(ctx: Ctx, id: SessionId) {
      const db = pgDb(ctx);
      const row = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, id as string))
        .then((r) => r[0]);
      if (!row) return err({ kind: "session-not-found" as const });
      return ok(toStored(row));
    },

    async create(ctx: Ctx, session: AgentSession) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const rev = crypto.randomUUID() as Rev;
      try {
        const row = await db
          .insert(agentSessions)
          .values({
            id: session.id as string,
            workspaceId: session.workspaceId as string,
            threadId: session.threadId as string | null,
            activeSceneId: session.activeSceneId,
            state: session.state,
            rev: rev as string,
            createdAt: now as number,
            updatedAt: now as number,
          })
          .returning()
          .then((r) => r[0]!);
        return ok(toStored(row));
      } catch (e) {
        if (isUniqueViolation(e))
          return err({ kind: "session-already-exists" as const });
        if (isForeignKeyViolation(e)) {
          const cn = constraintName(e) ?? "";
          if (cn.includes("thread_id"))
            return err({ kind: "thread-not-found" } as const);
          return err({ kind: "workspace-not-found" } as const);
        }
        throw e;
      }
    },

    async update(ctx: Ctx, input: UpdateSessionInput) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const newRev = crypto.randomUUID() as Rev;
      const { session, expectedRev } = input;

      const rows = await db
        .update(agentSessions)
        .set({
          workspaceId: session.workspaceId as string,
          threadId: session.threadId as string | null,
          activeSceneId: session.activeSceneId,
          state: session.state,
          rev: newRev as string,
          updatedAt: now as number,
        })
        .where(
          and(
            eq(agentSessions.id, session.id as string),
            eq(agentSessions.rev, expectedRev as string),
          )!,
        )
        .returning();

      if (rows.length === 0) {
        const existing = await db
          .select({ rev: agentSessions.rev })
          .from(agentSessions)
          .where(eq(agentSessions.id, session.id as string))
          .then((r) => r[0]);
        if (!existing) return err({ kind: "session-not-found" as const });
        return err({
          kind: "session-conflict" as const,
          currentRev: existing.rev as Rev,
        });
      }

      return ok(toStored(rows[0]!));
    },

    async delete(ctx: Ctx, id: SessionId) {
      const db = pgDb(ctx);
      const rows = await db
        .delete(agentSessions)
        .where(eq(agentSessions.id, id as string))
        .returning({ id: agentSessions.id });
      if (rows.length === 0)
        return err({ kind: "session-not-found" as const });
      return ok(undefined);
    },
  };
}
