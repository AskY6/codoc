import type { Result } from "@cobook/core";
import type { Ctx } from "./ctx.js";
import type { TxAborted } from "./errors.js";
import type { AgentStore } from "./stores/agent.js";
import type { AgentSessionStore } from "./stores/session.js";
import type { CodocStore } from "./stores/codoc.js";
import type { ThreadAgentStore } from "./stores/thread-agent.js";
import type { ThreadCodocStore } from "./stores/thread-codoc.js";
import type { ThreadStore } from "./stores/thread.js";
import type { WorkspaceAgentStore } from "./stores/workspace-agent.js";
import type { WorkspaceStore } from "./stores/workspace.js";

/**
 * Storage facade — the single port through which service code reaches
 * every persisted store, plus the transaction primitive.
 *
 * Services that perform a single-step action (one Store call) take
 * `storage.ctx()` for auto-commit semantics. Services that compose
 * multiple Store calls into one atomic action open a transaction with
 * `storage.withTransaction(fn)`; every Store call inside `fn` must be
 * made with the supplied `ctx` so they enrol in the same transaction.
 *
 * A concrete implementation is responsible for:
 *   - stamping `createdAt` / `updatedAt` via its injected Clock
 *   - allocating fresh `Rev` tokens and enforcing `expectedRev` checks
 *   - assigning monotonic `seq` numbers when appending chat messages
 *   - cascading workspace deletion across every dependent store
 *   - enforcing the ThreadCodoc workspace invariant on `link`
 */
export interface Storage {
  readonly codocs: CodocStore;
  readonly workspaces: WorkspaceStore;
  readonly agents: AgentStore;
  readonly threads: ThreadStore;
  readonly threadCodocs: ThreadCodocStore;
  readonly threadAgents: ThreadAgentStore;
  readonly workspaceAgents: WorkspaceAgentStore;
  readonly sessions: AgentSessionStore;

  /**
   * Default auto-commit context. Single-step service actions pass
   * this to store methods and let each call be its own mini-commit.
   */
  ctx(): Ctx;

  /**
   * Run `fn` inside an atomic transaction.
   *
   *   - If `fn` returns `ok(value)`, the transaction commits and
   *     `ok(value)` is returned.
   *   - If `fn` returns `err(e)`, the transaction rolls back and
   *     `err(e)` is returned unchanged (no wrapping).
   *   - If `fn` throws, the transaction rolls back and the exception
   *     propagates to the caller.
   *   - If the commit itself fails (disk error, deferred constraint,
   *     etc.), `err(TxAborted)` is returned.
   */
  withTransaction<T, E>(
    fn: (ctx: Ctx) => Promise<Result<T, E>>,
  ): Promise<Result<T, E | TxAborted>>;
}
