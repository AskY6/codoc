// Thin facade over `Storage.codocs`.
//
// Follows the shape documented in ./AGENTS.md: forward to one store,
// peel `StoredCodoc` envelopes into UI-shaped DTOs, map storage error
// variants to service variants. Slice 2 ships `get / list / create /
// delete`; `update` lands in slice 3 alongside the codoc detail page.

import type { Codoc, CodocId, Result, WorkspaceId } from "@cobook/core";
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
import type { CodocListItem } from "../types/codoc.js";

export interface CreateCodocRepoInput {
  readonly codoc: Codoc;
  readonly workspaceId: WorkspaceId;
}

export interface UpdateCodocRepoInput {
  readonly codoc: Codoc;
  readonly expectedRev: string;
}

/**
 * Peel a `StoredCodoc` envelope into the flattened `CodocListItem`
 * DTO. The title is pulled from `codoc.ast.meta.title`; the data /
 * schema maps that would not survive `JSON.stringify` are dropped
 * here. Slice 3 adds a `CodocDetail` DTO with a proper wire-safe ast
 * shape when the detail page needs the parsed structure.
 */
function toListItem(row: StoredCodoc): CodocListItem {
  return {
    id: row.codoc.id as string,
    path: row.codoc.path as string,
    title: row.codoc.ast.meta.title,
    updatedAt: row.updatedAt as number,
    rev: row.rev as string,
  };
}

export const codocRepo = {
  async get(
    ctx: ServiceCtx,
    id: CodocId,
  ): Promise<Result<CodocListItem, CodocNotFound>> {
    const r = await ctx.storage.codocs.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "codoc-not-found", id });
    return ok(toListItem(r.value));
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
   * Optimistic update. Symmetry with `workspaceRepo.update`: caller
   * hands back the opaque `rev` string it previously received, the
   * repo re-applies the `Rev` brand internally, and the store bumps
   * the rev on success. Slice 3 (codoc detail edit) is the first
   * caller — the method exists on the repo already so the wire shape
   * and error mapping are locked in alongside the slice 2 code.
   */
  async update(
    ctx: ServiceCtx,
    input: UpdateCodocRepoInput,
  ): Promise<Result<CodocListItem, CodocNotFound | CodocConflict>> {
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
    return ok(toListItem(r.value));
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
