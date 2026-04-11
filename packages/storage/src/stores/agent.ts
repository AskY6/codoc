import type { AgentId, AgentListing, Result } from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { AlreadyExists, Conflict, NotFound } from "../errors.js";
import type { Rev } from "../meta.js";
import type { StoredAgent } from "../stored.js";

export interface UpdateAgentInput {
  readonly listing: AgentListing;
  readonly expectedRev: Rev;
}

/**
 * Persistent store of agent listings.
 *
 * A listing is the declarative directory record ("agent X exists"),
 * not the runtime Agent. Runtime Agents are constructed at runtime
 * from a listing + the `@cobook/graph/agents` registry.
 *
 * Listings are global resources — not owned by any particular
 * workspace. Their availability inside a workspace is expressed by
 * `WorkspaceAgent` rows in `WorkspaceAgentStore`.
 */
export interface AgentStore {
  get(
    ctx: Ctx,
    id: AgentId,
  ): Promise<Result<StoredAgent, NotFound<"agent">>>;

  list(ctx: Ctx): Promise<readonly StoredAgent[]>;

  create(
    ctx: Ctx,
    listing: AgentListing,
  ): Promise<Result<StoredAgent, AlreadyExists<"agent">>>;

  update(
    ctx: Ctx,
    input: UpdateAgentInput,
  ): Promise<Result<StoredAgent, NotFound<"agent"> | Conflict<"agent">>>;

  delete(
    ctx: Ctx,
    id: AgentId,
  ): Promise<Result<void, NotFound<"agent">>>;
}
