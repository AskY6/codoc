// In-memory implementation of `WorkspaceStore`.
//
// Backed by a single `Map<WorkspaceId, StoredWorkspace>`. Each mutating
// call stamps `createdAt` / `updatedAt` via the injected Clock and
// allocates a fresh `Rev` from a monotonically increasing counter.
// `update` enforces the optimistic-concurrency contract: a stale
// `expectedRev` returns `Conflict<"workspace">` and leaves the row
// untouched.
//
// Cascading delete: the workspace store is the cascade root — deleting a
// workspace must atomically wipe every row owned by it. Each dependent
// store that has a real in-memory impl supplies a `cascade*` callback
// via `MemoryWorkspaceStoreDeps`; the stubs contribute no-ops. Slice 2
// wires `cascadeDeleteCodocs`.

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
  /**
   * Cascade hooks supplied by dependent stores that have real impls.
   * Each hook removes every row owned by the given workspace. Stubs
   * contribute nothing here.
   */
  readonly cascadeDeleteCodocs?: (workspaceId: WorkspaceId) => void;
  readonly cascadeDeleteThreads?: (workspaceId: WorkspaceId) => void;
}

export interface MemoryWorkspaceStore extends WorkspaceStore {
  /**
   * Escape hatch for peer stores that need to validate cross-store
   * invariants (e.g. `CodocStore.create` checking that the owning
   * workspace exists). Stays on the memory impl only — the port itself
   * exposes `get` for the same purpose, but peer stores avoid a
   * `Result`-shaped round-trip by reading this directly.
   */
  readonly __hasWorkspace: (id: WorkspaceId) => boolean;
}

export function createMemoryWorkspaceStore(
  deps: MemoryWorkspaceStoreDeps,
): MemoryWorkspaceStore {
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
      // Cascade across every dependent store that has a real impl.
      // Stubs contribute nothing — the slice that stops stubbing each
      // store wires its cascade hook here.
      deps.cascadeDeleteCodocs?.(id);
      deps.cascadeDeleteThreads?.(id);
      rows.delete(id);
      return ok(undefined);
    },

    __hasWorkspace(id: WorkspaceId): boolean {
      return rows.has(id);
    },
  };
}
