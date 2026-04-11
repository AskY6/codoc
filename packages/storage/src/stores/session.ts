import type { AgentSession, Result, SessionId } from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { AlreadyExists, Conflict, NotFound } from "../errors.js";
import type { Rev } from "../meta.js";
import type { StoredAgentSession } from "../stored.js";

export interface UpdateSessionInput {
  readonly session: AgentSession;
  readonly expectedRev: Rev;
}

/**
 * Persistent store of agent sessions — per-(agent, workspace,
 * optional thread) private state held across turns.
 *
 * `create` and `update` are split intentionally so that the caller's
 * intent is explicit and the concurrency contract for each path is
 * unambiguous:
 *
 *   - `create` fails with `AlreadyExists` if the session id is taken.
 *   - `update` fails with `NotFound` if it does not exist, and with
 *     `Conflict` if the caller's `expectedRev` is stale.
 *
 * Deleting a session never cascades; sessions are leaves.
 */
export interface AgentSessionStore {
  get(
    ctx: Ctx,
    id: SessionId,
  ): Promise<Result<StoredAgentSession, NotFound<"session">>>;

  create(
    ctx: Ctx,
    session: AgentSession,
  ): Promise<
    Result<
      StoredAgentSession,
      | AlreadyExists<"session">
      | NotFound<"workspace">
      | NotFound<"thread">
    >
  >;

  update(
    ctx: Ctx,
    input: UpdateSessionInput,
  ): Promise<
    Result<StoredAgentSession, NotFound<"session"> | Conflict<"session">>
  >;

  delete(
    ctx: Ctx,
    id: SessionId,
  ): Promise<Result<void, NotFound<"session">>>;
}
