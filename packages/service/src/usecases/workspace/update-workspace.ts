// update-workspace — rename / re-describe a workspace with optimistic
// concurrency.
//
// The caller hands back the `rev` it received on the list item; the
// store bumps the rev on success and returns `WorkspaceConflict` if
// another writer has moved the row on since. Unlike `createWorkspace`
// the use case does NOT mint an id — updates address an existing row,
// so the `id` comes in on the input. `IdGenerator` stays create-only,
// which is the pattern every future update use case copies.
//
// Single-store write; no transaction needed.

import type { Result, Workspace, WorkspaceId } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { WorkspaceConflict, WorkspaceNotFound } from "../../errors.js";
import { workspaceRepo } from "../../repo/workspace.js";
import type { WorkspaceListItem } from "../../types/workspace.js";

export interface UpdateWorkspaceInput {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly description: string | null;
  readonly expectedRev: string;
}

export type UpdateWorkspaceError = WorkspaceNotFound | WorkspaceConflict;

export async function updateWorkspace(
  ctx: ServiceCtx,
  input: UpdateWorkspaceInput,
): Promise<Result<WorkspaceListItem, UpdateWorkspaceError>> {
  const workspace: Workspace = {
    id: input.id,
    name: input.name,
    description: input.description,
  };
  return workspaceRepo.update(ctx, {
    workspace,
    expectedRev: input.expectedRev,
  });
}
