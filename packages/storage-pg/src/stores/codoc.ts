import type { CodocId, CodocPath, ThreadId, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  CodocStore,
  CreateCodocInput,
  Ctx,
  Rev,
  StoredCodoc,
  Timestamp,
  UpdateCodocInput,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { isForeignKeyViolation, isUniqueViolation } from "../pg-error.js";
import { codocs, threadCodocs } from "../schema.js";
import { deserializeAst, serializeAst } from "../serde.js";

interface Deps {
  readonly clock: Clock;
}

function toStored(row: {
  id: string;
  workspaceId: string;
  path: string;
  content: string;
  ast: unknown;
  rev: string;
  createdAt: number;
  updatedAt: number;
}): StoredCodoc {
  return {
    codoc: {
      id: row.id as CodocId,
      path: row.path as CodocPath,
      content: row.content,
      ast: deserializeAst(row.ast),
    },
    workspaceId: row.workspaceId as WorkspaceId,
    rev: row.rev as Rev,
    createdAt: row.createdAt as Timestamp,
    updatedAt: row.updatedAt as Timestamp,
  };
}

export function createPgCodocStore(deps: Deps): CodocStore {
  return {
    async get(ctx: Ctx, id: CodocId) {
      const db = pgDb(ctx);
      const row = await db
        .select()
        .from(codocs)
        .where(eq(codocs.id, id as string))
        .then((r) => r[0]);
      if (!row) return err({ kind: "codoc-not-found" as const });
      return ok(toStored(row));
    },

    async listByWorkspace(ctx: Ctx, workspaceId: WorkspaceId) {
      const db = pgDb(ctx);
      const rows = await db
        .select()
        .from(codocs)
        .where(eq(codocs.workspaceId, workspaceId as string));
      return rows.map(toStored);
    },

    async create(ctx: Ctx, input: CreateCodocInput) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const rev = crypto.randomUUID() as Rev;
      const { codoc, workspaceId } = input;
      try {
        const row = await db
          .insert(codocs)
          .values({
            id: codoc.id as string,
            workspaceId: workspaceId as string,
            path: codoc.path as string,
            content: codoc.content,
            ast: serializeAst(codoc.ast),
            rev: rev as string,
            createdAt: now as number,
            updatedAt: now as number,
          })
          .returning()
          .then((r) => r[0]!);
        return ok(toStored(row));
      } catch (e) {
        if (isUniqueViolation(e))
          return err({ kind: "codoc-already-exists" as const });
        if (isForeignKeyViolation(e))
          return err({ kind: "workspace-not-found" as const });
        throw e;
      }
    },

    async update(ctx: Ctx, input: UpdateCodocInput) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const newRev = crypto.randomUUID() as Rev;
      const { codoc, expectedRev } = input;

      const rows = await db
        .update(codocs)
        .set({
          path: codoc.path as string,
          content: codoc.content,
          ast: serializeAst(codoc.ast),
          rev: newRev as string,
          updatedAt: now as number,
        })
        .where(
          and(
            eq(codocs.id, codoc.id as string),
            eq(codocs.rev, expectedRev as string),
          )!,
        )
        .returning();

      if (rows.length === 0) {
        const existing = await db
          .select({ rev: codocs.rev })
          .from(codocs)
          .where(eq(codocs.id, codoc.id as string))
          .then((r) => r[0]);
        if (!existing) return err({ kind: "codoc-not-found" as const });
        return err({
          kind: "codoc-conflict" as const,
          currentRev: existing.rev as Rev,
        });
      }

      return ok(toStored(rows[0]!));
    },

    async delete(ctx: Ctx, id: CodocId) {
      const db = pgDb(ctx);

      // Check for referrers before deleting
      const referrers = await db
        .select({ threadId: threadCodocs.threadId })
        .from(threadCodocs)
        .where(eq(threadCodocs.codocId, id as string));

      if (referrers.length > 0) {
        return err({
          kind: "codoc-referenced" as const,
          byThreads: referrers.map(
            (r) => r.threadId as ThreadId,
          ),
        });
      }

      const rows = await db
        .delete(codocs)
        .where(eq(codocs.id, id as string))
        .returning({ id: codocs.id });
      if (rows.length === 0)
        return err({ kind: "codoc-not-found" as const });
      return ok(undefined);
    },
  };
}
