// In-memory implementation of `ThreadStore`.
//
// Backed by two Maps:
//   - `rows: Map<ThreadId, StoredChatThread>` — one envelope per thread
//   - `messagesByThread: Map<ThreadId, StoredChatMessage[]>` — append-only
//     message log, keyed by thread id and kept in insertion (seq) order.
//
// `appendMessage` assigns `seq` atomically via an explicit per-thread
// counter (`seqByThread`). Using the array length as `seq` would be
// cheaper, but would silently break monotonicity the day a future
// slice introduces per-message delete. The explicit counter keeps the
// invariant local to this file.
//
// `update` enforces the `expectedRev` optimistic-concurrency contract,
// identical to `CodocStore`. No UI in slice 4 edits a thread, but the
// store ships the method because the port requires it and the shape
// freezes the pattern for the slice that eventually adds rename.
//
// Cascading delete: `__cascadeDeleteByWorkspace` wipes every thread
// owned by a workspace along with its message log and seq counter. The
// workspace store's delete path calls this through a callback wired
// in `createMemoryStorage`.

import type {
  ChatMessage,
  ChatThread,
  Result,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AlreadyExists,
  Clock,
  Conflict,
  Ctx,
  ListMessagesOptions,
  NotFound,
  Rev,
  StoredChatMessage,
  StoredChatThread,
  ThreadStore,
  UpdateThreadInput,
} from "@cobook/storage";

export interface MemoryThreadStoreDeps {
  readonly clock: Clock;
  /** Cross-store check used by `create` to refuse orphan threads. */
  readonly workspaceExists: (workspaceId: WorkspaceId) => boolean;
  /** Cascade hooks called when a thread is deleted. */
  readonly cascadeDeleteThreadAgents?: (threadId: ThreadId) => void;
  readonly cascadeDeleteThreadCodocs?: (threadId: ThreadId) => void;
}

export interface MemoryThreadStore extends ThreadStore {
  /**
   * Internal hook: drop every thread (and its messages) that belongs
   * to a workspace. Called by `WorkspaceStore.delete` as part of its
   * cascade. Lives on the in-memory impl rather than the port because
   * cascading is a storage implementation detail.
   */
  readonly __cascadeDeleteByWorkspace: (workspaceId: WorkspaceId) => void;

  /**
   * Escape hatch for peer stores that need the workspace a thread
   * belongs to (e.g. `ThreadCodocStore` enforcing the same-workspace
   * constraint). Returns `undefined` if the thread does not exist.
   */
  readonly __getWorkspaceId: (id: ThreadId) => WorkspaceId | undefined;

  /** Returns `true` if a thread with the given id exists. */
  readonly __hasThread: (id: ThreadId) => boolean;
}

export function createMemoryThreadStore(
  deps: MemoryThreadStoreDeps,
): MemoryThreadStore {
  const rows = new Map<ThreadId, StoredChatThread>();
  const messagesByThread = new Map<ThreadId, StoredChatMessage[]>();
  const seqByThread = new Map<ThreadId, number>();
  let revCounter = 0;
  const nextRev = (): Rev => `t${++revCounter}` as Rev;

  const store: MemoryThreadStore = {
    async get(
      _ctx: Ctx,
      id: ThreadId,
    ): Promise<Result<StoredChatThread, NotFound<"thread">>> {
      const row = rows.get(id);
      if (!row) return err({ kind: "thread-not-found" });
      return ok(row);
    },

    async listByWorkspace(
      _ctx: Ctx,
      workspaceId: WorkspaceId,
    ): Promise<readonly StoredChatThread[]> {
      const matches: StoredChatThread[] = [];
      for (const row of rows.values()) {
        if (row.thread.workspaceId === workspaceId) matches.push(row);
      }
      return matches;
    },

    async create(
      _ctx: Ctx,
      thread: ChatThread,
    ): Promise<
      Result<StoredChatThread, AlreadyExists<"thread"> | NotFound<"workspace">>
    > {
      if (!deps.workspaceExists(thread.workspaceId)) {
        return err({ kind: "workspace-not-found" });
      }
      if (rows.has(thread.id)) {
        return err({ kind: "thread-already-exists" });
      }
      const now = deps.clock.now();
      const row: StoredChatThread = {
        thread,
        rev: nextRev(),
        createdAt: now,
        updatedAt: now,
      };
      rows.set(thread.id, row);
      messagesByThread.set(thread.id, []);
      seqByThread.set(thread.id, 0);
      return ok(row);
    },

    async update(
      _ctx: Ctx,
      input: UpdateThreadInput,
    ): Promise<
      Result<StoredChatThread, NotFound<"thread"> | Conflict<"thread">>
    > {
      const existing = rows.get(input.thread.id);
      if (!existing) return err({ kind: "thread-not-found" });
      if (existing.rev !== input.expectedRev) {
        return err({ kind: "thread-conflict", currentRev: existing.rev });
      }
      const row: StoredChatThread = {
        thread: input.thread,
        rev: nextRev(),
        createdAt: existing.createdAt,
        updatedAt: deps.clock.now(),
      };
      rows.set(input.thread.id, row);
      return ok(row);
    },

    async delete(
      _ctx: Ctx,
      id: ThreadId,
    ): Promise<Result<void, NotFound<"thread">>> {
      if (!rows.has(id)) return err({ kind: "thread-not-found" });
      deps.cascadeDeleteThreadAgents?.(id);
      deps.cascadeDeleteThreadCodocs?.(id);
      rows.delete(id);
      messagesByThread.delete(id);
      seqByThread.delete(id);
      return ok(undefined);
    },

    async appendMessage(
      _ctx: Ctx,
      message: ChatMessage,
    ): Promise<
      Result<StoredChatMessage, NotFound<"thread"> | AlreadyExists<"message">>
    > {
      const log = messagesByThread.get(message.threadId);
      if (!log) return err({ kind: "thread-not-found" });
      if (log.some((entry) => entry.message.id === message.id)) {
        return err({ kind: "message-already-exists" });
      }
      const currentSeq = seqByThread.get(message.threadId) ?? 0;
      const nextSeq = currentSeq + 1;
      seqByThread.set(message.threadId, nextSeq);
      const stored: StoredChatMessage = {
        message,
        seq: nextSeq,
        createdAt: deps.clock.now(),
      };
      log.push(stored);
      return ok(stored);
    },

    async listMessages(
      _ctx: Ctx,
      threadId: ThreadId,
      options?: ListMessagesOptions,
    ): Promise<readonly StoredChatMessage[]> {
      const log = messagesByThread.get(threadId);
      if (!log) return [];
      let result: readonly StoredChatMessage[] = log;
      if (options?.afterSeq !== undefined) {
        const threshold = options.afterSeq;
        result = result.filter((entry) => entry.seq > threshold);
      }
      if (options?.limit !== undefined) {
        result = result.slice(0, options.limit);
      }
      return result;
    },

    __cascadeDeleteByWorkspace(workspaceId: WorkspaceId): void {
      const doomed: ThreadId[] = [];
      for (const [id, row] of rows) {
        if (row.thread.workspaceId === workspaceId) doomed.push(id);
      }
      for (const id of doomed) {
        deps.cascadeDeleteThreadAgents?.(id);
        deps.cascadeDeleteThreadCodocs?.(id);
        rows.delete(id);
        messagesByThread.delete(id);
        seqByThread.delete(id);
      }
    },

    __getWorkspaceId(id: ThreadId): WorkspaceId | undefined {
      return rows.get(id)?.thread.workspaceId;
    },

    __hasThread(id: ThreadId): boolean {
      return rows.has(id);
    },
  };

  return store;
}
