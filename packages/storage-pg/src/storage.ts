import type { Result } from "@cobook/core";
import { err } from "@cobook/core";
import type { Clock, Ctx, Storage, TxAborted } from "@cobook/storage";
import { SystemClock } from "./clock.js";
import { createConnection } from "./connection.js";
import { pgCtx, type DrizzleDb } from "./ctx.js";
import { createPgAgentStore } from "./stores/agent.js";
import { createPgCodocStore } from "./stores/codoc.js";
import { createPgAgentSessionStore } from "./stores/session.js";
import { createPgThreadAgentStore } from "./stores/thread-agent.js";
import { createPgThreadCodocStore } from "./stores/thread-codoc.js";
import { createPgThreadStore } from "./stores/thread.js";
import { createPgWorkspaceAgentStore } from "./stores/workspace-agent.js";
import { createPgWorkspaceStore } from "./stores/workspace.js";
import type postgres from "postgres";

// ---------------------------------------------------------------------------
// RollbackSentinel
//
// Drizzle commits on normal return and rolls back on throw. The Storage
// port requires rollback when `fn` returns `err(...)`. We bridge the gap
// by throwing a private sentinel that the outer handler intercepts.
// ---------------------------------------------------------------------------

class RollbackSentinel {
  constructor(readonly result: Result<unknown, unknown>) {}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreatePgStorageOptions {
  readonly connectionString: string;
  readonly clock?: Clock;
  readonly max?: number;
}

export interface PgStorage extends Storage {
  /** Shut down the connection pool. */
  close(): Promise<void>;
}

export function createPgStorage(options: CreatePgStorageOptions): PgStorage {
  const clock = options.clock ?? new SystemClock();
  const { client, db } = createConnection({
    connectionString: options.connectionString,
    max: options.max,
  });

  const workspaces = createPgWorkspaceStore({ clock });
  const codocs = createPgCodocStore({ clock });
  const agents = createPgAgentStore({ clock });
  const threads = createPgThreadStore({ clock });
  const sessions = createPgAgentSessionStore({ clock });
  const threadCodocs = createPgThreadCodocStore({ clock });
  const threadAgents = createPgThreadAgentStore({ clock });
  const workspaceAgents = createPgWorkspaceAgentStore({ clock });

  return {
    workspaces,
    codocs,
    agents,
    threads,
    sessions,
    threadCodocs,
    threadAgents,
    workspaceAgents,

    ctx(): Ctx {
      return pgCtx(db);
    },

    async withTransaction<T, E>(
      fn: (ctx: Ctx) => Promise<Result<T, E>>,
    ): Promise<Result<T, E | TxAborted>> {
      try {
        return await db.transaction(async (tx) => {
          const txCtx = pgCtx(tx as unknown as DrizzleDb);
          const result = await fn(txCtx);
          if (!result.ok) {
            throw new RollbackSentinel(result);
          }
          return result;
        });
      } catch (e) {
        if (e instanceof RollbackSentinel) {
          return e.result as Result<T, E>;
        }
        return err({ kind: "tx-aborted" as const, cause: e });
      }
    },

    async close() {
      await (client as postgres.Sql).end();
    },
  };
}
