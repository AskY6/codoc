// Thin facade over `Storage.workspaces`.
//
// See ./AGENTS.md for the rules every repo module follows: forward to
// one store, peel envelopes, map storage errors to ServiceError. This
// module is the canonical example — copy its shape when adding other
// repo modules.

import type { Result, Workspace, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { Rev, StoredWorkspace } from "@cobook/storage";
import type { ServiceCtx } from "../context.js";
import type {
  WorkspaceAlreadyExists,
  WorkspaceConflict,
  WorkspaceNotFound,
} from "../errors.js";
import type { WorkspaceListItem } from "../types/workspace.js";
import { codocRepo } from "./codoc.js";
import { workspaceAgentRepo } from "./workspace-agent.js";

export interface UpdateWorkspaceRepoInput {
  readonly workspace: Workspace;
  readonly expectedRev: string;
}

async function toListItem(
  ctx: ServiceCtx,
  row: StoredWorkspace,
): Promise<WorkspaceListItem> {
  const [codocCount, agentCount] = await Promise.all([
    codocRepo.countByWorkspace(ctx, row.workspace.id),
    workspaceAgentRepo.countByWorkspace(ctx, row.workspace.id),
  ]);
  return {
    workspace: row.workspace,
    updatedAt: row.updatedAt as number,
    rev: row.rev as string,
    codocCount,
    agentCount,
  };
}

export const workspaceRepo = {
  async get(
    ctx: ServiceCtx,
    id: WorkspaceId,
  ): Promise<Result<Workspace, WorkspaceNotFound>> {
    const r = await ctx.storage.workspaces.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "workspace-not-found", id });
    return ok(r.value.workspace);
  },

  /**
   * `get` + folded metadata. Equivalent to `list` but for a single
   * workspace: returns the full `WorkspaceListItem` envelope
   * including `updatedAt`, `rev`, and `codocCount`. Used by the
   * `getWorkspace` use case that powers the detail page header.
   */
  async getListItem(
    ctx: ServiceCtx,
    id: WorkspaceId,
  ): Promise<Result<WorkspaceListItem, WorkspaceNotFound>> {
    const r = await ctx.storage.workspaces.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "workspace-not-found", id });
    return ok(await toListItem(ctx, r.value));
  },

  /**
   * Pure-read join of the workspace core type with its envelope's
   * `updatedAt`, `rev`, and a count of dependent codocs. The repo
   * layer is allowed to bundle cross-store metadata into a UI-shaped
   * DTO when it is logically one query and writes nothing — see
   * `repo/AGENTS.md`. The count is computed per row via
   * `codocRepo.countByWorkspace`; a real DB adapter will replace the
   * N+1 with a single `GROUP BY`.
   *
   * `rev` is peeled from the storage brand to a raw `string` here —
   * the service layer and above treat it as opaque, and the only
   * place a `Rev` brand exists is the storage port below.
   */
  async list(ctx: ServiceCtx): Promise<readonly WorkspaceListItem[]> {
    const rows = await ctx.storage.workspaces.list(ctx.storageCtx);
    return Promise.all(rows.map((row) => toListItem(ctx, row)));
  },

  async create(
    ctx: ServiceCtx,
    workspace: Workspace,
  ): Promise<Result<Workspace, WorkspaceAlreadyExists>> {
    const r = await ctx.storage.workspaces.create(ctx.storageCtx, workspace);
    if (!r.ok) return err({ kind: "workspace-already-exists", id: workspace.id });
    return ok(r.value.workspace);
  },

  /**
   * Optimistic update. The caller hands back the `rev` it previously
   * received on the list item; the store bumps the rev on success and
   * surfaces `WorkspaceConflict` if it has moved on under us. The
   * expected rev is passed as a plain `string` at this layer — the
   * repo re-applies the `Rev` brand internally, so the storage port
   * stays the only place that knows the brand exists.
   */
  async update(
    ctx: ServiceCtx,
    input: UpdateWorkspaceRepoInput,
  ): Promise<
    Result<WorkspaceListItem, WorkspaceNotFound | WorkspaceConflict>
  > {
    const r = await ctx.storage.workspaces.update(ctx.storageCtx, {
      workspace: input.workspace,
      expectedRev: input.expectedRev as Rev,
    });
    if (!r.ok) {
      if (r.error.kind === "workspace-not-found") {
        return err({ kind: "workspace-not-found", id: input.workspace.id });
      }
      return err({ kind: "workspace-conflict" });
    }
    return ok(await toListItem(ctx, r.value));
  },

  async delete(
    ctx: ServiceCtx,
    id: WorkspaceId,
  ): Promise<Result<void, WorkspaceNotFound>> {
    const r = await ctx.storage.workspaces.delete(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "workspace-not-found", id });
    return ok(undefined);
  },
};
