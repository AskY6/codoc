// In-memory implementation of `AgentSessionStore`.
//
// Backed by a `Map<SessionId, StoredAgentSession>`. `update` enforces
// the `expectedRev` optimistic-concurrency contract. `create`
// validates workspace + thread existence via dep callbacks.

import type { AgentSession, Result, SessionId, ThreadId, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AgentSessionStore,
  AlreadyExists,
  Clock,
  Conflict,
  Ctx,
  NotFound,
  Rev,
  StoredAgentSession,
  UpdateSessionInput,
} from "@cobook/storage";

export interface MemoryAgentSessionStoreDeps {
  readonly clock: Clock;
  readonly workspaceExists: (id: WorkspaceId) => boolean;
  readonly threadExists: (id: ThreadId) => boolean;
}

export interface MemoryAgentSessionStore extends AgentSessionStore {
  readonly __cascadeDeleteByWorkspace: (workspaceId: WorkspaceId) => void;
}

export function createMemoryAgentSessionStore(
  deps: MemoryAgentSessionStoreDeps,
): MemoryAgentSessionStore {
  const rows = new Map<SessionId, StoredAgentSession>();
  let revCounter = 0;
  const nextRev = (): Rev => `s${++revCounter}` as Rev;

  return {
    async get(
      _ctx: Ctx,
      id: SessionId,
    ): Promise<Result<StoredAgentSession, NotFound<"session">>> {
      const row = rows.get(id);
      if (!row) return err({ kind: "session-not-found" });
      return ok(row);
    },

    async create(
      _ctx: Ctx,
      session: AgentSession,
    ): Promise<
      Result<
        StoredAgentSession,
        | AlreadyExists<"session">
        | NotFound<"workspace">
        | NotFound<"thread">
      >
    > {
      if (!deps.workspaceExists(session.workspaceId)) {
        return err({ kind: "workspace-not-found" });
      }
      if (session.threadId !== null && !deps.threadExists(session.threadId)) {
        return err({ kind: "thread-not-found" });
      }
      if (rows.has(session.id)) {
        return err({ kind: "session-already-exists" });
      }
      const now = deps.clock.now();
      const row: StoredAgentSession = {
        session,
        rev: nextRev(),
        createdAt: now,
        updatedAt: now,
      };
      rows.set(session.id, row);
      return ok(row);
    },

    async update(
      _ctx: Ctx,
      input: UpdateSessionInput,
    ): Promise<
      Result<StoredAgentSession, NotFound<"session"> | Conflict<"session">>
    > {
      const existing = rows.get(input.session.id);
      if (!existing) return err({ kind: "session-not-found" });
      if (existing.rev !== input.expectedRev) {
        return err({ kind: "session-conflict", currentRev: existing.rev });
      }
      const row: StoredAgentSession = {
        session: input.session,
        rev: nextRev(),
        createdAt: existing.createdAt,
        updatedAt: deps.clock.now(),
      };
      rows.set(input.session.id, row);
      return ok(row);
    },

    async delete(
      _ctx: Ctx,
      id: SessionId,
    ): Promise<Result<void, NotFound<"session">>> {
      if (!rows.has(id)) return err({ kind: "session-not-found" });
      rows.delete(id);
      return ok(undefined);
    },

    __cascadeDeleteByWorkspace(workspaceId: WorkspaceId): void {
      const doomed: SessionId[] = [];
      for (const [id, row] of rows) {
        if (row.session.workspaceId === workspaceId) doomed.push(id);
      }
      for (const id of doomed) rows.delete(id);
    },
  };
}
