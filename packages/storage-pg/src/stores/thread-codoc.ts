import type { CodocId, ThreadCodoc, ThreadId, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  StoredThreadCodoc,
  Timestamp,
  ThreadCodocStore,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { isForeignKeyViolation } from "../pg-error.js";
import { chatThreads, codocs, threadCodocs } from "../schema.js";

interface Deps {
  readonly clock: Clock;
}

function toStored(row: {
  threadId: string;
  codocId: string;
  createdAt: number;
}): StoredThreadCodoc {
  return {
    link: {
      threadId: row.threadId as ThreadId,
      codocId: row.codocId as CodocId,
    },
    createdAt: row.createdAt as Timestamp,
  };
}

export function createPgThreadCodocStore(deps: Deps): ThreadCodocStore {
  return {
    async link(ctx: Ctx, link: ThreadCodoc) {
      const db = pgDb(ctx);
      const now = deps.clock.now();

      // Must check workspace-match invariant explicitly.
      // Load both the thread's and codoc's workspace_id.
      const [threadRow, codocRow] = await Promise.all([
        db
          .select({ workspaceId: chatThreads.workspaceId })
          .from(chatThreads)
          .where(eq(chatThreads.id, link.threadId as string))
          .then((r) => r[0]),
        db
          .select({ workspaceId: codocs.workspaceId })
          .from(codocs)
          .where(eq(codocs.id, link.codocId as string))
          .then((r) => r[0]),
      ]);

      if (!threadRow) return err({ kind: "thread-not-found" } as const);
      if (!codocRow) return err({ kind: "codoc-not-found" } as const);

      if (threadRow.workspaceId !== codocRow.workspaceId) {
        return err({
          kind: "thread-codoc-workspace-mismatch" as const,
          threadWorkspaceId: threadRow.workspaceId as WorkspaceId,
          codocWorkspaceId: codocRow.workspaceId as WorkspaceId,
        });
      }

      try {
        const rows = await db
          .insert(threadCodocs)
          .values({
            threadId: link.threadId as string,
            codocId: link.codocId as string,
            createdAt: now as number,
          })
          .onConflictDoNothing()
          .returning();

        if (rows.length > 0) return ok(toStored(rows[0]!));

        // Already linked — return existing
        const existing = await db
          .select()
          .from(threadCodocs)
          .where(
            and(
              eq(threadCodocs.threadId, link.threadId as string),
              eq(threadCodocs.codocId, link.codocId as string),
            ),
          )
          .then((r) => r[0]!);
        return ok(toStored(existing));
      } catch (e) {
        if (isForeignKeyViolation(e)) {
          // Shouldn't reach here since we checked above, but handle gracefully
          return err({ kind: "thread-not-found" } as const);
        }
        throw e;
      }
    },

    async unlink(ctx: Ctx, link: ThreadCodoc) {
      const db = pgDb(ctx);
      await db
        .delete(threadCodocs)
        .where(
          and(
            eq(threadCodocs.threadId, link.threadId as string),
            eq(threadCodocs.codocId, link.codocId as string),
          ),
        );
    },

    async listByThread(ctx: Ctx, threadId: ThreadId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(threadCodocs)
        .where(eq(threadCodocs.threadId, threadId as string));
      return rows.map(toStored);
    },

    async listByCodoc(ctx: Ctx, codocId: CodocId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(threadCodocs)
        .where(eq(threadCodocs.codocId, codocId as string));
      return rows.map(toStored);
    },
  };
}
