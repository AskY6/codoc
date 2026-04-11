// create-workspace — mint a fresh workspace from user input.
//
// The use case owns the id. Transports pass `{ name, description }`;
// they MUST NOT mint the id themselves, because doing so would let
// untrusted clients pick their own primary keys. The id comes from
// `ctx.idGen.workspaceId()`, which the composition root binds to a
// production impl (UUID v4) and tests bind to a deterministic counter.
//
// Single-store write; no transaction needed.

import type { Result, Workspace } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { WorkspaceAlreadyExists } from "../../errors.js";
import { workspaceRepo } from "../../repo/workspace.js";

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly description: string | null;
}

export type CreateWorkspaceError = WorkspaceAlreadyExists;

export async function createWorkspace(
  ctx: ServiceCtx,
  input: CreateWorkspaceInput,
): Promise<Result<Workspace, CreateWorkspaceError>> {
  const workspace: Workspace = {
    id: ctx.idGen.workspaceId(),
    name: input.name,
    description: input.description,
  };
  return workspaceRepo.create(ctx, workspace);
}
