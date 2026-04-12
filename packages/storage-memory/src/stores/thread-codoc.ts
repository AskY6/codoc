// In-memory implementation of `ThreadCodocStore`.
//
// Backed by a `Map<string, StoredThreadCodoc>` keyed by
// `${threadId}:${codocId}`. `link` enforces the same-workspace
// constraint: the thread's workspaceId must match the codoc's
// workspaceId. Both `link` and `unlink` are idempotent.

import type {
  CodocId,
  Result,
  ThreadCodoc,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  Clock,
  Ctx,
  NotFound,
  StoredThreadCodoc,
  ThreadCodocStore,
  ThreadCodocWorkspaceMismatch,
} from "@cobook/storage";

export interface MemoryThreadCodocStoreDeps {
  readonly clock: Clock;
  readonly getThreadWorkspaceId: (id: ThreadId) => WorkspaceId | undefined;
  readonly getCodocWorkspaceId: (id: CodocId) => WorkspaceId | undefined;
}

export interface MemoryThreadCodocStore extends ThreadCodocStore {
  readonly __cascadeDeleteByWorkspace: (workspaceId: WorkspaceId) => void;
  readonly __cascadeDeleteByThread: (threadId: ThreadId) => void;
  /** Sync helper: returns thread ids that reference a codoc. */
  readonly __threadIdsForCodoc: (codocId: CodocId) => readonly ThreadId[];
}

function key(link: ThreadCodoc): string {
  return `${link.threadId}:${link.codocId}`;
}

export function createMemoryThreadCodocStore(
  deps: MemoryThreadCodocStoreDeps,
): MemoryThreadCodocStore {
  const rows = new Map<string, StoredThreadCodoc>();

  return {
    async link(
      _ctx: Ctx,
      link: ThreadCodoc,
    ): Promise<
      Result<
        StoredThreadCodoc,
        NotFound<"thread"> | NotFound<"codoc"> | ThreadCodocWorkspaceMismatch
      >
    > {
      const threadWs = deps.getThreadWorkspaceId(link.threadId);
      if (threadWs === undefined) {
        return err({ kind: "thread-not-found" });
      }
      const codocWs = deps.getCodocWorkspaceId(link.codocId);
      if (codocWs === undefined) {
        return err({ kind: "codoc-not-found" });
      }
      if (threadWs !== codocWs) {
        return err({
          kind: "thread-codoc-workspace-mismatch",
          threadWorkspaceId: threadWs,
          codocWorkspaceId: codocWs,
        });
      }
      const k = key(link);
      const existing = rows.get(k);
      if (existing) return ok(existing);
      const row: StoredThreadCodoc = {
        link,
        createdAt: deps.clock.now(),
      };
      rows.set(k, row);
      return ok(row);
    },

    async unlink(_ctx: Ctx, link: ThreadCodoc): Promise<void> {
      rows.delete(key(link));
    },

    async listByThread(
      _ctx: Ctx,
      threadId: ThreadId,
    ): Promise<readonly StoredThreadCodoc[]> {
      const matches: StoredThreadCodoc[] = [];
      for (const row of rows.values()) {
        if (row.link.threadId === threadId) matches.push(row);
      }
      return matches;
    },

    async listByCodoc(
      _ctx: Ctx,
      codocId: CodocId,
    ): Promise<readonly StoredThreadCodoc[]> {
      const matches: StoredThreadCodoc[] = [];
      for (const row of rows.values()) {
        if (row.link.codocId === codocId) matches.push(row);
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

    __threadIdsForCodoc(codocId: CodocId): readonly ThreadId[] {
      const ids: ThreadId[] = [];
      for (const row of rows.values()) {
        if (row.link.codocId === codocId) ids.push(row.link.threadId);
      }
      return ids;
    },
  };
}
