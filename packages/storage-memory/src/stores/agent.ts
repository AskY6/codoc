// In-memory implementation of `AgentStore`.
//
// Backed by a `Map<AgentId, StoredAgent>`. Agents are global resources
// — no workspace ownership, no cascade hook. `update` enforces the
// `expectedRev` optimistic-concurrency contract.

import type { AgentId, AgentListing, Result } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AgentStore,
  AlreadyExists,
  Clock,
  Conflict,
  Ctx,
  NotFound,
  Rev,
  StoredAgent,
  UpdateAgentInput,
} from "@cobook/storage";

export interface MemoryAgentStoreDeps {
  readonly clock: Clock;
}

export interface MemoryAgentStore extends AgentStore {
  readonly __hasAgent: (id: AgentId) => boolean;
}

export function createMemoryAgentStore(
  deps: MemoryAgentStoreDeps,
): MemoryAgentStore {
  const rows = new Map<AgentId, StoredAgent>();
  let revCounter = 0;
  const nextRev = (): Rev => `a${++revCounter}` as Rev;

  return {
    async get(
      _ctx: Ctx,
      id: AgentId,
    ): Promise<Result<StoredAgent, NotFound<"agent">>> {
      const row = rows.get(id);
      if (!row) return err({ kind: "agent-not-found" });
      return ok(row);
    },

    async list(_ctx: Ctx): Promise<readonly StoredAgent[]> {
      return Array.from(rows.values());
    },

    async create(
      _ctx: Ctx,
      listing: AgentListing,
    ): Promise<Result<StoredAgent, AlreadyExists<"agent">>> {
      if (rows.has(listing.id)) {
        return err({ kind: "agent-already-exists" });
      }
      const now = deps.clock.now();
      const row: StoredAgent = {
        listing,
        rev: nextRev(),
        createdAt: now,
        updatedAt: now,
      };
      rows.set(listing.id, row);
      return ok(row);
    },

    async update(
      _ctx: Ctx,
      input: UpdateAgentInput,
    ): Promise<Result<StoredAgent, NotFound<"agent"> | Conflict<"agent">>> {
      const existing = rows.get(input.listing.id);
      if (!existing) return err({ kind: "agent-not-found" });
      if (existing.rev !== input.expectedRev) {
        return err({ kind: "agent-conflict", currentRev: existing.rev });
      }
      const row: StoredAgent = {
        listing: input.listing,
        rev: nextRev(),
        createdAt: existing.createdAt,
        updatedAt: deps.clock.now(),
      };
      rows.set(input.listing.id, row);
      return ok(row);
    },

    async delete(
      _ctx: Ctx,
      id: AgentId,
    ): Promise<Result<void, NotFound<"agent">>> {
      if (!rows.has(id)) return err({ kind: "agent-not-found" });
      rows.delete(id);
      return ok(undefined);
    },

    __hasAgent(id: AgentId): boolean {
      return rows.has(id);
    },
  };
}
