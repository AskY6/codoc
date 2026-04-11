// In-memory implementation of `WorkspaceStore`.
//
// Backed by a single `Map<WorkspaceId, StoredWorkspace>`. Each mutating
// call stamps `createdAt` / `updatedAt` via the injected Clock and
// allocates a fresh `Rev` from a monotonically increasing counter.
// `update` enforces the optimistic-concurrency contract: a stale
// `expectedRev` returns `Conflict<"workspace">` and leaves the row
// untouched.
//
// Cascading deletes (codocs, threads, …) are documented on the storage
// port but a no-op here for slice 1 — the dependent stores are still
// stubs and have no rows to clean up.

import type { Result, Workspace, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AlreadyExists,
  Clock,
  Conflict,
  Ctx,
  NotFound,
  Rev,
  StoredWorkspace,
  UpdateWorkspaceInput,
  WorkspaceStore,
} from "@cobook/storage";

export interface MemoryWorkspaceStoreDeps {
  readonly clock: Clock;
}

export function createMemoryWorkspaceStore(
  deps: MemoryWorkspaceStoreDeps,
): WorkspaceStore {
  const rows = new Map<WorkspaceId, StoredWorkspace>();
  let revCounter = 0;
  const nextRev = (): Rev => `r${++revCounter}` as Rev;

  return {
    async get(
      _ctx: Ctx,
      id: WorkspaceId,
    ): Promise<Result<StoredWorkspace, NotFound<"workspace">>> {
      const row = rows.get(id);
      if (!row) return err({ kind: "workspace-not-found" });
      return ok(row);
    },

    async list(_ctx: Ctx): Promise<readonly StoredWorkspace[]> {
      return Array.from(rows.values());
    },

    async create(
      _ctx: Ctx,
      workspace: Workspace,
    ): Promise<Result<StoredWorkspace, AlreadyExists<"workspace">>> {
      if (rows.has(workspace.id)) {
        return err({ kind: "workspace-already-exists" });
      }
      const now = deps.clock.now();
      const row: StoredWorkspace = {
        workspace,
        rev: nextRev(),
        createdAt: now,
        updatedAt: now,
      };
      rows.set(workspace.id, row);
      return ok(row);
    },

    async update(
      _ctx: Ctx,
      input: UpdateWorkspaceInput,
    ): Promise<
      Result<StoredWorkspace, NotFound<"workspace"> | Conflict<"workspace">>
    > {
      const existing = rows.get(input.workspace.id);
      if (!existing) return err({ kind: "workspace-not-found" });
      if (existing.rev !== input.expectedRev) {
        return err({ kind: "workspace-conflict", currentRev: existing.rev });
      }
      const row: StoredWorkspace = {
        workspace: input.workspace,
        rev: nextRev(),
        createdAt: existing.createdAt,
        updatedAt: deps.clock.now(),
      };
      rows.set(input.workspace.id, row);
      return ok(row);
    },

    async delete(
      _ctx: Ctx,
      id: WorkspaceId,
    ): Promise<Result<void, NotFound<"workspace">>> {
      if (!rows.has(id)) return err({ kind: "workspace-not-found" });
      rows.delete(id);
      // NOTE: cascade across codocs / threads / agents lands when those
      // stores stop being stubs.
      return ok(undefined);
    },
  };
}
