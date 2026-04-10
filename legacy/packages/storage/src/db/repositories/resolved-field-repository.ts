import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { codocResolvedFields } from "../schema.js";
import type { ResolvedField, ResolvedFieldRepository } from "./types.js";

export function createResolvedFieldRepository(
  db: DbExecutor,
): ResolvedFieldRepository {
  return {
    async replaceForCodoc(workspaceId, codocId, fields) {
      // Always clear existing rows for this codoc first — the (workspace_id,
      // node_id) unique index would otherwise trip if a node_id moved between
      // codocs, and we also need to evict removed fields.
      await db
        .delete(codocResolvedFields)
        .where(eq(codocResolvedFields.codocId, codocId));

      if (fields.length === 0) return;

      await db.insert(codocResolvedFields).values(
        fields.map((f) => ({
          workspaceId,
          codocId,
          nodeId: f.nodeId,
          value: f.value ?? null,
          state: f.state,
        })),
      );
    },

    async upsertField(workspaceId, codocId, nodeId, value, state) {
      await db
        .insert(codocResolvedFields)
        .values({
          workspaceId,
          codocId,
          nodeId,
          value: value ?? null,
          state,
        })
        .onConflictDoUpdate({
          target: [codocResolvedFields.workspaceId, codocResolvedFields.nodeId],
          set: {
            codocId,
            value: value ?? null,
            state,
            builtAt: new Date(),
          },
        });
    },

    async listByCodoc(codocId) {
      return (await db
        .select()
        .from(codocResolvedFields)
        .where(eq(codocResolvedFields.codocId, codocId))) as ResolvedField[];
    },

    async listByWorkspace(workspaceId) {
      return (await db
        .select()
        .from(codocResolvedFields)
        .where(
          eq(codocResolvedFields.workspaceId, workspaceId),
        )) as ResolvedField[];
    },

    async findByNodeId(workspaceId, nodeId) {
      const [row] = await db
        .select()
        .from(codocResolvedFields)
        .where(
          and(
            eq(codocResolvedFields.workspaceId, workspaceId),
            eq(codocResolvedFields.nodeId, nodeId),
          ),
        );
      return row as ResolvedField | undefined;
    },
  };
}
