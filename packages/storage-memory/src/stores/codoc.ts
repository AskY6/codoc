// In-memory implementation of `CodocStore`.
//
// Backed by a `Map<CodocId, StoredCodoc>` keyed by codoc id. Each row
// carries the owning `workspaceId` on the envelope, so
// `listByWorkspace` is a linear scan — fine for the dev server's
// in-memory adapter; the PG adapter will use an index.
//
// Concurrency: `update` enforces the `expectedRev` optimistic concurrency
// contract, stamping `createdAt` / `updatedAt` via the injected Clock.
//
// `delete` refuses with `CodocReferenced` when any `ThreadCodoc` still
// points at the codoc. Slice 2 keeps `ThreadCodocStore` a stub, so the
// in-memory impl has no referrers to consult — a future slice that ships
// the real thread-codoc store will extend this method to call
// `ctx.threadCodocs.listByCodoc` (passed in via deps). The surface stays
// the same so callers don't need to change.

import type { Codoc, CodocId, Result, WorkspaceId } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AlreadyExists,
  Clock,
  CodocReferenced,
  CodocStore,
  Conflict,
  CreateCodocInput,
  Ctx,
  NotFound,
  Rev,
  StoredCodoc,
  UpdateCodocInput,
} from "@cobook/storage";

export interface MemoryCodocStoreDeps {
  readonly clock: Clock;
  /** Returns the ids of this workspace's live codocs. Used by `delete`. */
  readonly workspaceExists: (workspaceId: WorkspaceId) => boolean;
}

export interface MemoryCodocStore extends CodocStore {
  /**
   * Internal hook: drop every codoc that belongs to a workspace.
   * Called by `WorkspaceStore.delete` as part of its cascade. Lives on
   * the in-memory impl rather than the port because cascading is a
   * storage implementation detail.
   */
  readonly __cascadeDeleteByWorkspace: (workspaceId: WorkspaceId) => void;
}

export function createMemoryCodocStore(
  deps: MemoryCodocStoreDeps,
): MemoryCodocStore {
  const rows = new Map<CodocId, StoredCodoc>();
  let revCounter = 0;
  const nextRev = (): Rev => `c${++revCounter}` as Rev;

  const store: MemoryCodocStore = {
    async get(
      _ctx: Ctx,
      id: CodocId,
    ): Promise<Result<StoredCodoc, NotFound<"codoc">>> {
      const row = rows.get(id);
      if (!row) return err({ kind: "codoc-not-found" });
      return ok(row);
    },

    async listByWorkspace(
      _ctx: Ctx,
      workspaceId: WorkspaceId,
    ): Promise<readonly StoredCodoc[]> {
      const matches: StoredCodoc[] = [];
      for (const row of rows.values()) {
        if (row.workspaceId === workspaceId) matches.push(row);
      }
      return matches;
    },

    async create(
      _ctx: Ctx,
      input: CreateCodocInput,
    ): Promise<
      Result<StoredCodoc, AlreadyExists<"codoc"> | NotFound<"workspace">>
    > {
      if (!deps.workspaceExists(input.workspaceId)) {
        return err({ kind: "workspace-not-found" });
      }
      if (rows.has(input.codoc.id)) {
        return err({ kind: "codoc-already-exists" });
      }
      const now = deps.clock.now();
      const row: StoredCodoc = {
        codoc: input.codoc,
        workspaceId: input.workspaceId,
        rev: nextRev(),
        createdAt: now,
        updatedAt: now,
      };
      rows.set(input.codoc.id, row);
      return ok(row);
    },

    async update(
      _ctx: Ctx,
      input: UpdateCodocInput,
    ): Promise<Result<StoredCodoc, NotFound<"codoc"> | Conflict<"codoc">>> {
      const existing = rows.get(input.codoc.id);
      if (!existing) return err({ kind: "codoc-not-found" });
      if (existing.rev !== input.expectedRev) {
        return err({ kind: "codoc-conflict", currentRev: existing.rev });
      }
      const row: StoredCodoc = {
        codoc: input.codoc,
        workspaceId: existing.workspaceId,
        rev: nextRev(),
        createdAt: existing.createdAt,
        updatedAt: deps.clock.now(),
      };
      rows.set(input.codoc.id, row);
      return ok(row);
    },

    async delete(
      _ctx: Ctx,
      id: CodocId,
    ): Promise<Result<void, NotFound<"codoc"> | CodocReferenced>> {
      if (!rows.has(id)) return err({ kind: "codoc-not-found" });
      // Slice 2 note: `ThreadCodocStore` is still a stub, so there are
      // never any referrers. When slice 4 ships the real thread-codoc
      // store, wire its `listByCodoc` into deps and consult it here.
      rows.delete(id);
      return ok(undefined);
    },

    __cascadeDeleteByWorkspace(workspaceId: WorkspaceId): void {
      const doomed: CodocId[] = [];
      for (const [id, row] of rows) {
        if (row.workspaceId === workspaceId) doomed.push(id);
      }
      for (const id of doomed) rows.delete(id);
    },
  };

  return store;
}
