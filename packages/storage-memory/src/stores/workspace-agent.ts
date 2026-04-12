// In-memory implementation of `WorkspaceAgentStore`.
//
// Backed by a `Map<string, StoredWorkspaceAgent>` keyed by
// `${workspaceId}:${agentId}`. Both `link` and `unlink` are
// idempotent. `link` validates workspace + agent existence via dep
// callbacks.

import type {
  AgentId,
  Result,
  WorkspaceAgent,
  WorkspaceId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  NotFound,
  StoredWorkspaceAgent,
  WorkspaceAgentStore,
} from "@cobook/storage";

export interface MemoryWorkspaceAgentStoreDeps {
  readonly clock: Clock;
  readonly workspaceExists: (id: WorkspaceId) => boolean;
  readonly agentExists: (id: AgentId) => boolean;
}

export interface MemoryWorkspaceAgentStore extends WorkspaceAgentStore {
  readonly __cascadeDeleteByWorkspace: (workspaceId: WorkspaceId) => void;
}

function key(link: WorkspaceAgent): string {
  return `${link.workspaceId}:${link.agentId}`;
}

export function createMemoryWorkspaceAgentStore(
  deps: MemoryWorkspaceAgentStoreDeps,
): MemoryWorkspaceAgentStore {
  const rows = new Map<string, StoredWorkspaceAgent>();

  return {
    async link(
      _ctx: Ctx,
      link: WorkspaceAgent,
    ): Promise<
      Result<StoredWorkspaceAgent, NotFound<"workspace"> | NotFound<"agent">>
    > {
      if (!deps.workspaceExists(link.workspaceId)) {
        return err({ kind: "workspace-not-found" });
      }
      if (!deps.agentExists(link.agentId)) {
        return err({ kind: "agent-not-found" });
      }
      const k = key(link);
      const existing = rows.get(k);
      if (existing) return ok(existing);
      const row: StoredWorkspaceAgent = {
        link,
        createdAt: deps.clock.now(),
      };
      rows.set(k, row);
      return ok(row);
    },

    async unlink(_ctx: Ctx, link: WorkspaceAgent): Promise<void> {
      rows.delete(key(link));
    },

    async listByWorkspace(
      _ctx: Ctx,
      workspaceId: WorkspaceId,
    ): Promise<readonly StoredWorkspaceAgent[]> {
      const matches: StoredWorkspaceAgent[] = [];
      for (const row of rows.values()) {
        if (row.link.workspaceId === workspaceId) matches.push(row);
      }
      return matches;
    },

    async listByAgent(
      _ctx: Ctx,
      agentId: AgentId,
    ): Promise<readonly StoredWorkspaceAgent[]> {
      const matches: StoredWorkspaceAgent[] = [];
      for (const row of rows.values()) {
        if (row.link.agentId === agentId) matches.push(row);
      }
      return matches;
    },

    __cascadeDeleteByWorkspace(workspaceId: WorkspaceId): void {
      const doomed: string[] = [];
      for (const [k, row] of rows) {
        if (row.link.workspaceId === workspaceId) doomed.push(k);
      }
      for (const k of doomed) rows.delete(k);
    },
  };
}
