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
// participate in the workspace / thread cascade close over each other
// here, via lazy callbacks so the construction order stays unambiguous.

import type { CodocId, Result, ThreadId, WorkspaceId } from "@cobook/core";
import type { Clock, Ctx, Storage, TxAborted } from "@cobook/storage";
import { SystemClock } from "./clock.js";
import { memoryCtx } from "./ctx.js";
import { createMemoryAgentStore } from "./stores/agent.js";
import { createMemoryCodocStore } from "./stores/codoc.js";
import { createMemoryAgentSessionStore } from "./stores/session.js";
import { createMemoryThreadAgentStore } from "./stores/thread-agent.js";
import { createMemoryThreadCodocStore } from "./stores/thread-codoc.js";
import { createMemoryThreadStore } from "./stores/thread.js";
import { createMemoryWorkspaceAgentStore } from "./stores/workspace-agent.js";
import { createMemoryWorkspaceStore } from "./stores/workspace.js";

export interface CreateMemoryStorageOptions {
  readonly clock?: Clock;
}

export function createMemoryStorage(
  options: CreateMemoryStorageOptions = {},
): Storage {
  const clock = options.clock ?? new SystemClock();

  // Late-binding refs — each ref is populated after the target store
  // is constructed. The dep callbacks read through the ref so the
  // construction order among stores does not matter.

  let codocCascadeRef: ((id: WorkspaceId) => void) | null = null;
  let threadCascadeRef: ((id: WorkspaceId) => void) | null = null;
  let workspaceAgentCascadeRef: ((id: WorkspaceId) => void) | null = null;
  let threadAgentWsCascadeRef: ((id: WorkspaceId) => void) | null = null;
  let threadCodocWsCascadeRef: ((id: WorkspaceId) => void) | null = null;
  let sessionCascadeRef: ((id: WorkspaceId) => void) | null = null;

  let threadAgentThreadCascadeRef: ((id: ThreadId) => void) | null = null;
  let threadCodocThreadCascadeRef: ((id: ThreadId) => void) | null = null;

  let codocReferrerRef: ((id: CodocId) => readonly ThreadId[]) | null = null;

  // --- construct stores ---

  const workspaces = createMemoryWorkspaceStore({
    clock,
    cascadeDeleteCodocs: (id) => codocCascadeRef?.(id),
    cascadeDeleteThreads: (id) => threadCascadeRef?.(id),
    cascadeDeleteWorkspaceAgents: (id) => workspaceAgentCascadeRef?.(id),
    cascadeDeleteThreadAgents: (id) => threadAgentWsCascadeRef?.(id),
    cascadeDeleteThreadCodocs: (id) => threadCodocWsCascadeRef?.(id),
    cascadeDeleteSessions: (id) => sessionCascadeRef?.(id),
  });

  const agents = createMemoryAgentStore({ clock });

  const codocs = createMemoryCodocStore({
    clock,
    workspaceExists: (id) => workspaces.__hasWorkspace(id),
    listReferringThreads: (id) => codocReferrerRef?.(id) ?? [],
  });

  const threads = createMemoryThreadStore({
    clock,
    workspaceExists: (id) => workspaces.__hasWorkspace(id),
    cascadeDeleteThreadAgents: (id) => threadAgentThreadCascadeRef?.(id),
    cascadeDeleteThreadCodocs: (id) => threadCodocThreadCascadeRef?.(id),
  });

  const workspaceAgents = createMemoryWorkspaceAgentStore({
    clock,
    workspaceExists: (id) => workspaces.__hasWorkspace(id),
    agentExists: (id) => agents.__hasAgent(id),
  });

  const threadAgents = createMemoryThreadAgentStore({
    clock,
    threadExists: (id) => threads.__hasThread(id),
    agentExists: (id) => agents.__hasAgent(id),
    getThreadWorkspaceId: (id) => threads.__getWorkspaceId(id),
  });

  const threadCodocs = createMemoryThreadCodocStore({
    clock,
    getThreadWorkspaceId: (id) => threads.__getWorkspaceId(id),
    getCodocWorkspaceId: (id) => codocs.__getWorkspaceId(id),
  });

  const sessions = createMemoryAgentSessionStore({
    clock,
    workspaceExists: (id) => workspaces.__hasWorkspace(id),
    threadExists: (id) => threads.__hasThread(id),
  });

  // --- populate late-binding refs ---

  codocCascadeRef = (id) => codocs.__cascadeDeleteByWorkspace(id);
  threadCascadeRef = (id) => threads.__cascadeDeleteByWorkspace(id);
  workspaceAgentCascadeRef = (id) => workspaceAgents.__cascadeDeleteByWorkspace(id);
  threadAgentWsCascadeRef = (id) => threadAgents.__cascadeDeleteByWorkspace(id);
  threadCodocWsCascadeRef = (id) => threadCodocs.__cascadeDeleteByWorkspace(id);
  sessionCascadeRef = (id) => sessions.__cascadeDeleteByWorkspace(id);

  threadAgentThreadCascadeRef = (id) => threadAgents.__cascadeDeleteByThread(id);
  threadCodocThreadCascadeRef = (id) => threadCodocs.__cascadeDeleteByThread(id);

  codocReferrerRef = (id) => threadCodocs.__threadIdsForCodoc(id);

  return {
    workspaces,
    codocs,
    agents,
    threads,
    threadCodocs,
    threadAgents,
    workspaceAgents,
    sessions,

    ctx(): Ctx {
      return memoryCtx();
    },

    async withTransaction<T, E>(
      fn: (ctx: Ctx) => Promise<Result<T, E>>,
    ): Promise<Result<T, E | TxAborted>> {
      return fn(memoryCtx());
    },
  };
}
