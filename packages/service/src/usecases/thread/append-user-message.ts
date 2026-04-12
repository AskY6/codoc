// append-user-message — append a user message to a thread.
//
// Slice 4 is intentionally agent-free: there is no `assistant`
// variant on the wire yet, and no runtime orchestration. The use
// case mints a fresh `MessageId` via `ctx.idGen.messageId()`,
// constructs the `user` variant of the `ChatMessage` ADT, and lets
// the storage layer assign `seq` atomically.
//
// When slice 5 lands, a sibling `run-agent-turn` use case will
// append an `assistant` message (with `agentId` and tool-call
// metadata) through the same `ThreadStore.appendMessage` port. This
// use case stays user-only to keep the two variants auditable at the
// service boundary.

import type {
  ChatMessage,
  MessageId,
  Result,
  ThreadId,
} from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type {
  MessageAlreadyExists,
  ThreadNotFound,
} from "../../errors.js";
import { threadRepo } from "../../repo/thread.js";
import type { ThreadMessage } from "../../types/thread.js";

export interface AppendUserMessageInput {
  readonly threadId: ThreadId;
  readonly content: string;
}

export type AppendUserMessageError = ThreadNotFound | MessageAlreadyExists;

export async function appendUserMessage(
  ctx: ServiceCtx,
  input: AppendUserMessageInput,
): Promise<Result<ThreadMessage, AppendUserMessageError>> {
  const id: MessageId = ctx.idGen.messageId();
  const message: ChatMessage = {
    kind: "user",
    id,
    threadId: input.threadId,
    content: input.content,
  };
  return threadRepo.appendMessage(ctx, message);
}
