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
//
// Cross-store wiring: dependent stores that need to read sibling state
// (the codoc store checking "does this workspace exist?") or that
// participate in the workspace cascade close over each other here, via
// lazy callbacks so the construction order stays unambiguous.

import type { Result } from "@cobook/core";
import type { Clock, Ctx, Storage, TxAborted } from "@cobook/storage";
import { SystemClock } from "./clock.js";
import { memoryCtx } from "./ctx.js";
import { createMemoryCodocStore } from "./stores/codoc.js";
import {
  agentStub,
  sessionStub,
  threadAgentStub,
  threadCodocStub,
  workspaceAgentStub,
} from "./stores/stubs.js";
import { createMemoryThreadStore } from "./stores/thread.js";
import { createMemoryWorkspaceStore } from "./stores/workspace.js";

export interface CreateMemoryStorageOptions {
  readonly clock?: Clock;
}

export function createMemoryStorage(
  options: CreateMemoryStorageOptions = {},
): Storage {
  const clock = options.clock ?? new SystemClock();

  // Two-phase construction so the real stores can close over each
  // other. `workspaces` needs to know how to cascade into codocs and
  // threads; the dependent stores need to know whether a workspace id
  // is live. Each store reads the other through a function reference
  // that is populated below, so declaration order does not matter.
  let codocCascadeRef: ((id: Parameters<typeof workspaces.delete>[1]) => void) | null =
    null;
  let threadCascadeRef: ((id: Parameters<typeof workspaces.delete>[1]) => void) | null =
    null;

  const workspaces = createMemoryWorkspaceStore({
    clock,
    cascadeDeleteCodocs: (id) => codocCascadeRef?.(id),
    cascadeDeleteThreads: (id) => threadCascadeRef?.(id),
  });

  const codocs = createMemoryCodocStore({
    clock,
    workspaceExists: (id) => workspaces.__hasWorkspace(id),
  });
  codocCascadeRef = (id) => codocs.__cascadeDeleteByWorkspace(id);

  const threads = createMemoryThreadStore({
    clock,
    workspaceExists: (id) => workspaces.__hasWorkspace(id),
  });
  threadCascadeRef = (id) => threads.__cascadeDeleteByWorkspace(id);

  return {
    workspaces,
    codocs,
    agents: agentStub,
    threads,
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
