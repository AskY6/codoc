// list-codocs-by-workspace — return every codoc in a workspace as a
// UI-shaped DTO.
//
// Single-store read; no transaction needed. The use case first
// checks the owning workspace exists so the UI gets a clean
// `workspace-not-found` instead of silently rendering an empty list
// for a typo'd id. Slice 3 will likely replace the up-front check
// with an auth-level capability look-up against the same workspace.

import type { Result, WorkspaceId } from "@cobook/core";
import { ok } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { WorkspaceNotFound } from "../../errors.js";
import { codocRepo } from "../../repo/codoc.js";
import { workspaceRepo } from "../../repo/workspace.js";
import type { CodocListItem } from "../../types/codoc.js";

export type ListCodocsByWorkspaceError = WorkspaceNotFound;

export async function listCodocsByWorkspace(
  ctx: ServiceCtx,
  workspaceId: WorkspaceId,
): Promise<Result<readonly CodocListItem[], ListCodocsByWorkspaceError>> {
  const exists = await workspaceRepo.get(ctx, workspaceId);
  if (!exists.ok) return exists;
  const items = await codocRepo.listByWorkspace(ctx, workspaceId);
  return ok(items);
}
