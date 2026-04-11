import type {
  AgentId,
  Result,
  ThreadAgent,
  ThreadId,
} from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { NotFound } from "../errors.js";
import type { StoredThreadAgent } from "../stored.js";

/**
 * Thread ↔ agent link store.
 *
 * Records which agents are activated inside a given thread. Both
 * `link` and `unlink` are idempotent.
 */
export interface ThreadAgentStore {
  link(
    ctx: Ctx,
    link: ThreadAgent,
  ): Promise<
    Result<StoredThreadAgent, NotFound<"thread"> | NotFound<"agent">>
  >;

  unlink(ctx: Ctx, link: ThreadAgent): Promise<void>;

  listByThread(
    ctx: Ctx,
    threadId: ThreadId,
  ): Promise<readonly StoredThreadAgent[]>;

  listByAgent(
    ctx: Ctx,
    agentId: AgentId,
  ): Promise<readonly StoredThreadAgent[]>;
}
