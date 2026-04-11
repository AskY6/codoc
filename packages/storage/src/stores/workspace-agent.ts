import type {
  AgentId,
  Result,
  WorkspaceAgent,
  WorkspaceId,
} from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { NotFound } from "../errors.js";
import type { StoredWorkspaceAgent } from "../stored.js";

/**
 * Workspace ↔ agent link store.
 *
 * Records which (global) agents are enabled inside a given workspace.
 * Both `link` and `unlink` are idempotent.
 */
export interface WorkspaceAgentStore {
  link(
    ctx: Ctx,
    link: WorkspaceAgent,
  ): Promise<
    Result<StoredWorkspaceAgent, NotFound<"workspace"> | NotFound<"agent">>
  >;

  unlink(ctx: Ctx, link: WorkspaceAgent): Promise<void>;

  listByWorkspace(
    ctx: Ctx,
    workspaceId: WorkspaceId,
  ): Promise<readonly StoredWorkspaceAgent[]>;

  listByAgent(
    ctx: Ctx,
    agentId: AgentId,
  ): Promise<readonly StoredWorkspaceAgent[]>;
}
