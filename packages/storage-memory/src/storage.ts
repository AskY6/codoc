// `createMemoryStorage` — composition root for the in-memory `Storage`.
//
// Tests and the dev server call this once and pass the result around
// as the canonical `Storage`. The clock is injectable so that tests
// that need deterministic timestamps can supply their own.
//
// Memory has no real transactions: `withTransaction(fn)` just calls
// `fn` with a fresh `Ctx`. The shape of the API still matches the
// port, so use case code that opens transactions today will keep
// working unchanged when a real storage adapter lands.

import type { Result } from "@cobook/core";
import type { Clock, Ctx, Storage, TxAborted } from "@cobook/storage";
import { SystemClock } from "./clock.js";
import { memoryCtx } from "./ctx.js";
import {
  agentStub,
  codocStub,
  sessionStub,
  threadAgentStub,
  threadCodocStub,
  threadStub,
  workspaceAgentStub,
} from "./stores/stubs.js";
import { createMemoryWorkspaceStore } from "./stores/workspace.js";

export interface CreateMemoryStorageOptions {
  readonly clock?: Clock;
}

export function createMemoryStorage(
  options: CreateMemoryStorageOptions = {},
): Storage {
  const clock = options.clock ?? new SystemClock();
  const workspaces = createMemoryWorkspaceStore({ clock });

  return {
    workspaces,
    codocs: codocStub,
    agents: agentStub,
    threads: threadStub,
    threadCodocs: threadCodocStub,
    threadAgents: threadAgentStub,
    workspaceAgents: workspaceAgentStub,
    sessions: sessionStub,

    ctx(): Ctx {
      return memoryCtx();
    },

    async withTransaction<T, E>(
      fn: (ctx: Ctx) => Promise<Result<T, E>>,
    ): Promise<Result<T, E | TxAborted>> {
      // Memory has no atomic boundary — each call already mutates the
      // backing Map in place. We still honour the contract: errors and
      // exceptions propagate exactly as the port specifies.
      return fn(memoryCtx());
    },
  };
}
