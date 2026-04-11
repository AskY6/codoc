// get-workspace — return a single workspace as a UI-shaped DTO.
//
// Powers the workspace detail page header. Same envelope shape as
// `listWorkspaces` returns, so the UI does not need a second type
// and cache hydration from the list query is trivial.
//
// Single-store read via `workspaceRepo.getListItem`, which folds
// `codocCount` in as a pure-read cross-store join. No transaction.

import type { Result, WorkspaceId } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { WorkspaceNotFound } from "../../errors.js";
import { workspaceRepo } from "../../repo/workspace.js";
import type { WorkspaceListItem } from "../../types/workspace.js";

export type GetWorkspaceError = WorkspaceNotFound;

export async function getWorkspace(
  ctx: ServiceCtx,
  id: WorkspaceId,
): Promise<Result<WorkspaceListItem, GetWorkspaceError>> {
  return workspaceRepo.getListItem(ctx, id);
}
