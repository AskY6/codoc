// delete-workspace — remove a workspace by id.
//
// The cascade across codocs / threads / agents lives in the storage
// layer (each store owns its own invariants), so the use case is a
// straight pass-through. Single-store call; no transaction.

import type { Result, WorkspaceId } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { WorkspaceNotFound } from "../../errors.js";
import { workspaceRepo } from "../../repo/workspace.js";

export type DeleteWorkspaceError = WorkspaceNotFound;

export async function deleteWorkspace(
  ctx: ServiceCtx,
  id: WorkspaceId,
): Promise<Result<void, DeleteWorkspaceError>> {
  return workspaceRepo.delete(ctx, id);
}
