// list-threads-by-workspace — return every chat thread in a
// workspace as a UI-shaped `ThreadListItem`.
//
// Mirrors `listCodocsByWorkspace`: pre-checks the workspace so the
// UI gets a clean `workspace-not-found` instead of silently
// rendering an empty list for a typo'd id. Single-store read; no
// transaction needed.

import type { Result, WorkspaceId } from "@cobook/core";
import { ok } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { WorkspaceNotFound } from "../../errors.js";
import { threadRepo } from "../../repo/thread.js";
import { workspaceRepo } from "../../repo/workspace.js";
import type { ThreadListItem } from "../../types/thread.js";

export type ListThreadsByWorkspaceError = WorkspaceNotFound;

export async function listThreadsByWorkspace(
  ctx: ServiceCtx,
  workspaceId: WorkspaceId,
): Promise<Result<readonly ThreadListItem[], ListThreadsByWorkspaceError>> {
  const exists = await workspaceRepo.get(ctx, workspaceId);
  if (!exists.ok) return exists;
  const items = await threadRepo.listByWorkspace(ctx, workspaceId);
  return ok(items);
}
