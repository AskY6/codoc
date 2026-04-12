// In-memory implementation of `ThreadAgentStore`.
//
// Backed by a `Map<string, StoredThreadAgent>` keyed by
// `${threadId}:${agentId}`. Both `link` and `unlink` are idempotent.
// `link` validates thread + agent existence via dep callbacks.

import type {
  AgentId,
  Result,
  ThreadAgent,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  NotFound,
  StoredThreadAgent,
  ThreadAgentStore,
} from "@cobook/storage";

export interface MemoryThreadAgentStoreDeps {
  readonly clock: Clock;
  readonly threadExists: (id: ThreadId) => boolean;
  readonly agentExists: (id: AgentId) => boolean;
  readonly getThreadWorkspaceId: (id: ThreadId) => WorkspaceId | undefined;
}

export interface MemoryThreadAgentStore extends ThreadAgentStore {
  readonly __cascadeDeleteByWorkspace: (workspaceId: WorkspaceId) => void;
  readonly __cascadeDeleteByThread: (threadId: ThreadId) => void;
}

function key(link: ThreadAgent): string {
  return `${link.threadId}:${link.agentId}`;
}

export function createMemoryThreadAgentStore(
  deps: MemoryThreadAgentStoreDeps,
): MemoryThreadAgentStore {
  const rows = new Map<string, StoredThreadAgent>();

  return {
    async link(
      _ctx: Ctx,
      link: ThreadAgent,
    ): Promise<
      Result<StoredThreadAgent, NotFound<"thread"> | NotFound<"agent">>
    > {
      if (!deps.threadExists(link.threadId)) {
        return err({ kind: "thread-not-found" });
      }
      if (!deps.agentExists(link.agentId)) {
        return err({ kind: "agent-not-found" });
      }
      const k = key(link);
      const existing = rows.get(k);
      if (existing) return ok(existing);
      const row: StoredThreadAgent = {
        link,
        createdAt: deps.clock.now(),
      };
      rows.set(k, row);
      return ok(row);
    },

    async unlink(_ctx: Ctx, link: ThreadAgent): Promise<void> {
      rows.delete(key(link));
    },

    async listByThread(
      _ctx: Ctx,
      threadId: ThreadId,
    ): Promise<readonly StoredThreadAgent[]> {
      const matches: StoredThreadAgent[] = [];
      for (const row of rows.values()) {
        if (row.link.threadId === threadId) matches.push(row);
      }
      return matches;
    },

    async listByAgent(
      _ctx: Ctx,
      agentId: AgentId,
    ): Promise<readonly StoredThreadAgent[]> {
      const matches: StoredThreadAgent[] = [];
      for (const row of rows.values()) {
        if (row.link.agentId === agentId) matches.push(row);
      }
      return matches;
    },

    __cascadeDeleteByWorkspace(workspaceId: WorkspaceId): void {
      const doomed: string[] = [];
      for (const [k, row] of rows) {
        const ws = deps.getThreadWorkspaceId(row.link.threadId);
        if (ws === workspaceId) doomed.push(k);
      }
      for (const k of doomed) rows.delete(k);
    },

    __cascadeDeleteByThread(threadId: ThreadId): void {
      const doomed: string[] = [];
      for (const [k, row] of rows) {
        if (row.link.threadId === threadId) doomed.push(k);
      }
      for (const k of doomed) rows.delete(k);
    },
  };
}
