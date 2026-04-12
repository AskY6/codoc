// DTOs returned by thread use cases.
//
// Unlike `CodocListItem` (which is flattened because `Codoc.ast`
// holds `ReadonlyMap`s that don't survive `JSON.stringify`),
// `ChatThread` is all plain primitives and `ChatMessage` is a plain
// role ADT. So the thread DTOs follow the `WorkspaceListItem`
// convention of nesting the canonical core type — the wire shape and
// the in-memory shape match, and the transport layer is a pure
// `JSON.stringify`.
//
// `ThreadDetail` is the "page bundle" shape: a single fetch returns
// the thread envelope plus its full message list. The slice-4
// decision (documented in `usecases/thread/AGENTS.md`) is that any
// page which always loads a thread together with its messages should
// prefer one round-trip over two parallel queries.

import type { ChatMessage, ChatThread } from "@cobook/core";

export interface ThreadListItem {
  readonly thread: ChatThread;
  readonly updatedAt: number;
  readonly rev: string;
}

export interface ThreadMessage {
  readonly message: ChatMessage;
  /**
   * Thread-local monotonic integer assigned atomically at append
   * time. Callers may treat it as an opaque order key; combined with
   * `message.id` it is the canonical cursor for pagination.
   */
  readonly seq: number;
  readonly createdAt: number;
}

/**
 * Page-bundle DTO returned by `getThread`. One round-trip hydrates
 * both the thread envelope and its full message log — the slice-4
 * reference shape for any future multi-fetch use case.
 */
export interface ThreadDetail {
  readonly thread: ThreadListItem;
  readonly messages: readonly ThreadMessage[];
}
