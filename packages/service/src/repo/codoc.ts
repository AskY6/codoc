// Thin facade over `Storage.codocs`.
//
// Follows the shape documented in ./AGENTS.md: forward to one store,
// peel `StoredCodoc` envelopes into UI-shaped DTOs, map storage error
// variants to service variants.
//
// Two peels live here, mirroring `workspaceRepo`:
//   - `toListItem` — flat row used on the workspace detail list.
//   - `toDetail`   — list item + `content`, used by the detail page
//                    and by the content update use case.
// Both drop the ast intentionally: it holds `ReadonlyMap`s which do
// not survive `JSON.stringify`. See `../types/codoc.ts`.
//
// `getCodoc` is the odd one out — it returns the full core `Codoc`,
// not a DTO. The `updateCodocContent` use case needs the existing ast
// to preserve meta / data when only content changes, and the repo is
// the single place allowed to touch the storage port.

import type { Codoc, CodocAST, CodocId, CodocPath, Result, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { Rev, StoredCodoc } from "@cobook/storage";
import type { ServiceCtx } from "../context.js";
import type {
  CodocAlreadyExists,
  CodocConflict,
  CodocNotFound,
  CodocReferenced,
  WorkspaceNotFound,
} from "../errors.js";
import type { CodocDetail, CodocListItem } from "../types/codoc.js";
import { resolveDataFields, toAstMap } from "../usecases/codoc/resolve.js";

export interface CreateCodocRepoInput {
  readonly codoc: Codoc;
  readonly workspaceId: WorkspaceId;
}

export interface UpdateCodocRepoInput {
  readonly codoc: Codoc;
  readonly expectedRev: string;
}

function toListItem(row: StoredCodoc): CodocListItem {
  return {
    id: row.codoc.id as string,
    path: row.codoc.path as string,
    title: row.codoc.ast.meta.title,
    updatedAt: row.updatedAt as number,
    rev: row.rev as string,
  };
}

function toDetail(
  row: StoredCodoc,
  resolvedData: Record<string, unknown> | null = null,
): CodocDetail {
  return {
    id: row.codoc.id as string,
    path: row.codoc.path as string,
    title: row.codoc.ast.meta.title,
    content: row.codoc.content,
    updatedAt: row.updatedAt as number,
    rev: row.rev as string,
    resolvedData,
  };
}

export const codocRepo = {
  /**
   * Read a codoc as a flat list item. Kept for symmetry with
   * `workspaceRepo.getListItem`; slice 3's read path uses `getDetail`
   * instead because the detail page needs `content`.
   */
  async get(
    ctx: ServiceCtx,
    id: CodocId,
  ): Promise<Result<CodocListItem, CodocNotFound>> {
    const r = await ctx.storage.codocs.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "codoc-not-found", id });
    return ok(toListItem(r.value));
  },

  /**
   * Read a codoc as a detail DTO (list item + raw `content`). Powers
   * the `getCodoc` use case that hydrates the detail page.
   */
  async getDetail(
    ctx: ServiceCtx,
    id: CodocId,
  ): Promise<Result<CodocDetail, CodocNotFound>> {
    const r = await ctx.storage.codocs.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "codoc-not-found", id });
    return ok(toDetail(r.value));
  },

  /**
   * Read the full core `Codoc` (ast included) together with the
   * owning `workspaceId`. Used by `updateCodocContent` to preserve
   * the ast when only content changes and to look up workspace
   * siblings for DAG validation.
   */
  async getCodoc(
    ctx: ServiceCtx,
    id: CodocId,
  ): Promise<Result<{ codoc: Codoc; workspaceId: WorkspaceId }, CodocNotFound>> {
    const r = await ctx.storage.codocs.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "codoc-not-found", id });
    return ok({ codoc: r.value.codoc, workspaceId: r.value.workspaceId });
  },

  /**
   * Read a codoc as a detail DTO with resolved data fields. Fetches
   * all workspace siblings and resolves `$ref` fields at read time.
   */
  async getDetailResolved(
    ctx: ServiceCtx,
    id: CodocId,
  ): Promise<Result<CodocDetail, CodocNotFound>> {
    const r = await ctx.storage.codocs.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "codoc-not-found", id });

    const siblings = await ctx.storage.codocs.listByWorkspace(
      ctx.storageCtx,
      r.value.workspaceId,
    );
    const astMap = toAstMap(siblings);
    const resolved = resolveDataFields(r.value.codoc, astMap);
    return ok(toDetail(r.value, resolved));
  },

  /**
   * Return the full AST map for every codoc in a workspace. Used by
   * `updateCodocContent` for DAG validation and resolution.
   */
  async listAstsByWorkspace(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
  ): Promise<ReadonlyMap<CodocPath, CodocAST>> {
    const rows = await ctx.storage.codocs.listByWorkspace(
      ctx.storageCtx,
      workspaceId,
    );
    return toAstMap(rows);
  },

  async listByWorkspace(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
  ): Promise<readonly CodocListItem[]> {
    const rows = await ctx.storage.codocs.listByWorkspace(
      ctx.storageCtx,
      workspaceId,
    );
    return rows.map(toListItem);
  },

  /**
   * Pure-read join: how many codocs live in this workspace. Used by
   * `workspaceRepo.list` / `workspaceRepo.getListItem` to fold the
   * count onto `WorkspaceListItem`. Kept on the codoc repo so the
   * workspace repo never reaches into a sibling store directly —
   * see `../../usecases/workspace/AGENTS.md` for the decision and
   * rationale.
   */
  async countByWorkspace(
    ctx: ServiceCtx,
    workspaceId: WorkspaceId,
  ): Promise<number> {
    const rows = await ctx.storage.codocs.listByWorkspace(
      ctx.storageCtx,
      workspaceId,
    );
    return rows.length;
  },

  async create(
    ctx: ServiceCtx,
    input: CreateCodocRepoInput,
  ): Promise<
    Result<CodocListItem, CodocAlreadyExists | WorkspaceNotFound>
  > {
    const r = await ctx.storage.codocs.create(ctx.storageCtx, {
      codoc: input.codoc,
      workspaceId: input.workspaceId,
    });
    if (!r.ok) {
      if (r.error.kind === "workspace-not-found") {
        return err({ kind: "workspace-not-found", id: input.workspaceId });
      }
      return err({ kind: "codoc-already-exists", id: input.codoc.id });
    }
    return ok(toListItem(r.value));
  },

  /**
   * Optimistic update. Caller hands back the opaque `rev` string it
   * previously received; the repo re-applies the `Rev` brand
   * internally and the store bumps the rev on success. Returns a
   * `CodocDetail` because slice 3's only caller (the content editor)
   * wants `content` back in the response.
   */
  async update(
    ctx: ServiceCtx,
    input: UpdateCodocRepoInput,
  ): Promise<Result<CodocDetail, CodocNotFound | CodocConflict>> {
    const r = await ctx.storage.codocs.update(ctx.storageCtx, {
      codoc: input.codoc,
      expectedRev: input.expectedRev as Rev,
    });
    if (!r.ok) {
      if (r.error.kind === "codoc-not-found") {
        return err({ kind: "codoc-not-found", id: input.codoc.id });
      }
      return err({ kind: "codoc-conflict" });
    }
    return ok(toDetail(r.value));
  },

  async delete(
    ctx: ServiceCtx,
    id: CodocId,
  ): Promise<Result<void, CodocNotFound | CodocReferenced>> {
    const r = await ctx.storage.codocs.delete(ctx.storageCtx, id);
    if (!r.ok) {
      if (r.error.kind === "codoc-not-found") {
        return err({ kind: "codoc-not-found", id });
      }
      return err({
        kind: "codoc-referenced",
        byThreads: r.error.byThreads,
      });
    }
    return ok(undefined);
  },
};
