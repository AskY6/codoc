// list-workspaces — return every workspace as a UI-shaped DTO.
//
// Single-store read; no transaction needed. The repo layer already
// bundles `updatedAt` onto each row, so this use case is a pure
// pass-through. It still exists as a use case (rather than letting
// transports call the repo directly) because (a) auth checks will
// land here, (b) future cross-aggregate joins (codoc count, etc.)
// land here in slice 2, and (c) keeping the layering consistent
// matters more than saving four lines.

import type { Result } from "@cobook/core";
import { ok } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import { workspaceRepo } from "../../repo/workspace.js";
import type { WorkspaceListItem } from "../../types/workspace.js";

export type ListWorkspacesError = never;

export async function listWorkspaces(
  ctx: ServiceCtx,
): Promise<Result<readonly WorkspaceListItem[], ListWorkspacesError>> {
  const items = await workspaceRepo.list(ctx);
  return ok(items);
}
