import type { Result, Workspace, WorkspaceId } from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { AlreadyExists, Conflict, NotFound } from "../errors.js";
import type { Rev } from "../meta.js";
import type { StoredWorkspace } from "../stored.js";

export interface UpdateWorkspaceInput {
  readonly workspace: Workspace;
  readonly expectedRev: Rev;
}

/**
 * Persistent store of workspaces.
 *
 * Deletion cascades: removing a workspace atomically removes every row
 * owned by it — codocs, threads, chat messages, thread↔codoc links,
 * thread↔agent links, workspace↔agent links, and agent sessions. The
 * cascade happens inside the same transaction as the workspace row
 * removal, so callers never observe a half-deleted workspace.
 *
 * Because cross-workspace codoc references are disallowed, the cascade
 * never has to consult resources outside the workspace.
 */
export interface WorkspaceStore {
  get(
    ctx: Ctx,
    id: WorkspaceId,
  ): Promise<Result<StoredWorkspace, NotFound<"workspace">>>;

  list(ctx: Ctx): Promise<readonly StoredWorkspace[]>;

  create(
    ctx: Ctx,
    workspace: Workspace,
  ): Promise<Result<StoredWorkspace, AlreadyExists<"workspace">>>;

  update(
    ctx: Ctx,
    input: UpdateWorkspaceInput,
  ): Promise<
    Result<StoredWorkspace, NotFound<"workspace"> | Conflict<"workspace">>
  >;

  delete(
    ctx: Ctx,
    id: WorkspaceId,
  ): Promise<Result<void, NotFound<"workspace">>>;
}
