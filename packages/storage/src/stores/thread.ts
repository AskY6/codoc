import type {
  ChatMessage,
  ChatThread,
  Result,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";
import type { Ctx } from "../ctx.js";
import type { AlreadyExists, Conflict, NotFound } from "../errors.js";
import type { Rev } from "../meta.js";
import type { StoredChatMessage, StoredChatThread } from "../stored.js";

export interface UpdateThreadInput {
  readonly thread: ChatThread;
  readonly expectedRev: Rev;
}

export interface ListMessagesOptions {
  /** Return only messages with `seq > afterSeq`. */
  readonly afterSeq?: number;
  /** Cap the number of rows returned. */
  readonly limit?: number;
}

/**
 * Persistent store of chat threads and their messages.
 *
 * Threads and messages form a single aggregate: a message belongs to
 * exactly one thread and cannot outlive it. `appendMessage` assigns a
 * thread-local monotonic `seq` atomically, so services never need to
 * coordinate sequence numbers themselves.
 *
 * Deleting a thread removes all of its messages atomically (and any
 * `ThreadCodoc` / `ThreadAgent` links — those cascades live on the
 * join stores so that each store owns its own invariants).
 */
export interface ThreadStore {
  get(
    ctx: Ctx,
    id: ThreadId,
  ): Promise<Result<StoredChatThread, NotFound<"thread">>>;

  listByWorkspace(
    ctx: Ctx,
    workspaceId: WorkspaceId,
  ): Promise<readonly StoredChatThread[]>;

  create(
    ctx: Ctx,
    thread: ChatThread,
  ): Promise<
    Result<StoredChatThread, AlreadyExists<"thread"> | NotFound<"workspace">>
  >;

  update(
    ctx: Ctx,
    input: UpdateThreadInput,
  ): Promise<
    Result<StoredChatThread, NotFound<"thread"> | Conflict<"thread">>
  >;

  delete(
    ctx: Ctx,
    id: ThreadId,
  ): Promise<Result<void, NotFound<"thread">>>;

  /**
   * Append `message` to its enclosing thread. The store assigns `seq`
   * atomically, so concurrent appends are totally ordered without
   * service-side coordination.
   */
  appendMessage(
    ctx: Ctx,
    message: ChatMessage,
  ): Promise<
    Result<StoredChatMessage, NotFound<"thread"> | AlreadyExists<"message">>
  >;

  /** List messages of a thread in ascending `seq` order. */
  listMessages(
    ctx: Ctx,
    threadId: ThreadId,
    options?: ListMessagesOptions,
  ): Promise<readonly StoredChatMessage[]>;
}
