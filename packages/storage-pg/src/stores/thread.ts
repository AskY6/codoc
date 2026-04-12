import type { ChatMessage, ChatThread, ThreadId, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  ListMessagesOptions,
  Rev,
  StoredChatMessage,
  StoredChatThread,
  Timestamp,
  ThreadStore,
  UpdateThreadInput,
} from "@cobook/storage";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { isForeignKeyViolation, isUniqueViolation } from "../pg-error.js";
import { chatMessages, chatThreads } from "../schema.js";
import { deserializeMessage, serializeMessage } from "../serde.js";

interface Deps {
  readonly clock: Clock;
}

function toStoredThread(row: {
  id: string;
  workspaceId: string;
  title: string | null;
  rev: string;
  createdAt: number;
  updatedAt: number;
}): StoredChatThread {
  return {
    thread: {
      id: row.id as ThreadId,
      workspaceId: row.workspaceId as WorkspaceId,
      title: row.title,
    },
    rev: row.rev as Rev,
    createdAt: row.createdAt as Timestamp,
    updatedAt: row.updatedAt as Timestamp,
  };
}

function toStoredMessage(row: {
  id: string;
  threadId: string;
  kind: string;
  content: string;
  agentId: string | null;
  metadata: unknown;
  seq: number;
  createdAt: number;
}): StoredChatMessage {
  return {
    message: deserializeMessage({
      id: row.id,
      threadId: row.threadId,
      kind: row.kind,
      content: row.content,
      agentId: row.agentId,
      metadata: row.metadata,
    }),
    seq: row.seq,
    createdAt: row.createdAt as Timestamp,
  };
}

export function createPgThreadStore(deps: Deps): ThreadStore {
  return {
    async get(ctx: Ctx, id: ThreadId) {
      const db = pgDb(ctx);
      const row = await db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.id, id as string))
        .then((r) => r[0]);
      if (!row) return err({ kind: "thread-not-found" as const });
      return ok(toStoredThread(row));
    },

    async listByWorkspace(ctx: Ctx, workspaceId: WorkspaceId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.workspaceId, workspaceId as string));
      return rows.map(toStoredThread);
    },

    async create(ctx: Ctx, thread: ChatThread) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const rev = crypto.randomUUID() as Rev;
      try {
        const row = await db
          .insert(chatThreads)
          .values({
            id: thread.id as string,
            workspaceId: thread.workspaceId as string,
            title: thread.title,
            rev: rev as string,
            createdAt: now as number,
            updatedAt: now as number,
          })
          .returning()
          .then((r) => r[0]!);
        return ok(toStoredThread(row));
      } catch (e) {
        if (isUniqueViolation(e))
          return err({ kind: "thread-already-exists" as const });
        if (isForeignKeyViolation(e))
          return err({ kind: "workspace-not-found" as const });
        throw e;
      }
    },

    async update(ctx: Ctx, input: UpdateThreadInput) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const newRev = crypto.randomUUID() as Rev;
      const { thread, expectedRev } = input;

      const rows = await db
        .update(chatThreads)
        .set({
          title: thread.title,
          rev: newRev as string,
          updatedAt: now as number,
        })
        .where(
          and(
            eq(chatThreads.id, thread.id as string),
            eq(chatThreads.rev, expectedRev as string),
          )!,
        )
        .returning();

      if (rows.length === 0) {
        const existing = await db
          .select({ rev: chatThreads.rev })
          .from(chatThreads)
          .where(eq(chatThreads.id, thread.id as string))
          .then((r) => r[0]);
        if (!existing) return err({ kind: "thread-not-found" as const });
        return err({
          kind: "thread-conflict" as const,
          currentRev: existing.rev as Rev,
        });
      }

      return ok(toStoredThread(rows[0]!));
    },

    async delete(ctx: Ctx, id: ThreadId) {
      const db = pgDb(ctx);
      const rows = await db
        .delete(chatThreads)
        .where(eq(chatThreads.id, id as string))
        .returning({ id: chatThreads.id });
      if (rows.length === 0)
        return err({ kind: "thread-not-found" as const });
      return ok(undefined);
    },

    async appendMessage(ctx: Ctx, message: ChatMessage) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const cols = serializeMessage(message);

      try {
        const row = await db
          .insert(chatMessages)
          .values({
            id: cols.id,
            threadId: cols.threadId,
            kind: cols.kind,
            content: cols.content,
            agentId: cols.agentId,
            metadata: cols.metadata,
            seq: sql`(SELECT COALESCE(MAX(${chatMessages.seq}), 0) + 1 FROM ${chatMessages} WHERE ${chatMessages.threadId} = ${cols.threadId})`,
            createdAt: now as number,
          })
          .returning()
          .then((r) => r[0]!);
        return ok(toStoredMessage(row));
      } catch (e) {
        if (isUniqueViolation(e)) {
          return err({ kind: "message-already-exists" as const });
        }
        if (isForeignKeyViolation(e))
          return err({ kind: "thread-not-found" as const });
        throw e;
      }
    },

    async listMessages(
      ctx: Ctx,
      threadId: ThreadId,
      options?: ListMessagesOptions,
    ) {
      const db = pgDb(ctx);
      const conditions = [eq(chatMessages.threadId, threadId as string)];
      if (options?.afterSeq !== undefined) {
        conditions.push(gt(chatMessages.seq, options.afterSeq));
      }

      let query = db
        .select()
        .from(chatMessages)
        .where(and(...conditions))
        .orderBy(asc(chatMessages.seq));

      if (options?.limit !== undefined) {
        query = query.limit(options.limit) as typeof query;
      }

      const rows = await query;
      return rows.map(toStoredMessage);
    },
  };
}
