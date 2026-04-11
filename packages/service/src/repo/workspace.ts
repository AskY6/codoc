// Thin facade over `Storage.workspaces`.
//
// See ./AGENTS.md for the rules every repo module follows: forward to
// one store, peel envelopes, map storage errors to ServiceError. This
// module is the canonical example — copy its shape when adding other
// repo modules.

import type { Result, Workspace, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { ServiceCtx } from "../context.js";
import type { WorkspaceAlreadyExists, WorkspaceNotFound } from "../errors.js";

export const workspaceRepo = {
  async get(
    ctx: ServiceCtx,
    id: WorkspaceId,
  ): Promise<Result<Workspace, WorkspaceNotFound>> {
    const r = await ctx.storage.workspaces.get(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "workspace-not-found", id });
    return ok(r.value.workspace);
  },

  async list(ctx: ServiceCtx): Promise<readonly Workspace[]> {
    const rows = await ctx.storage.workspaces.list(ctx.storageCtx);
    return rows.map((row) => row.workspace);
  },

  async create(
    ctx: ServiceCtx,
    workspace: Workspace,
  ): Promise<Result<Workspace, WorkspaceAlreadyExists>> {
    const r = await ctx.storage.workspaces.create(ctx.storageCtx, workspace);
    if (!r.ok) return err({ kind: "workspace-already-exists", id: workspace.id });
    return ok(r.value.workspace);
  },

  async delete(
    ctx: ServiceCtx,
    id: WorkspaceId,
  ): Promise<Result<void, WorkspaceNotFound>> {
    const r = await ctx.storage.workspaces.delete(ctx.storageCtx, id);
    if (!r.ok) return err({ kind: "workspace-not-found", id });
    return ok(undefined);
  },

  // NOTE: `update` is deliberately omitted from this scaffold. It needs
  // an `expectedRev`, and `Rev` is an opaque storage type — which means
  // either the use case hands the rev down, or repo fetches it first.
  // That tradeoff is part of the "should repo ever see Rev?" question;
  // resolve it when the first update use case lands and add the method
  // here in line with whatever answer we pick.
};
