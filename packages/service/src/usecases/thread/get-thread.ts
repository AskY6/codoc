// get-thread — return a thread together with its full message log as
// a single "page bundle" DTO.
//
// This is slice 4's reference shape for multi-fetch use cases: a
// single use case + single round-trip hydrates an entire page that
// always loads both pieces together. Splitting into two parallel
// queries would pay the latency twice and force the UI to
// coordinate two loading states. See `./AGENTS.md`.
//
// Single-store read; no transaction needed. Both fetches go through
// the same storage store, so there is no atomicity hazard — and
// even a slice-local race (a concurrent `appendMessage` between the
// two calls) would just pick up the freshly appended message on the
// second call, which is harmless.

import type { Result, ThreadId } from "@cobook/core";
import { ok } from "@cobook/core";
import type { ServiceCtx } from "../../context.js";
import type { ThreadNotFound } from "../../errors.js";
import { threadAgentRepo } from "../../repo/thread-agent.js";
import { threadCodocRepo } from "../../repo/thread-codoc.js";
import { threadRepo } from "../../repo/thread.js";
import type { ThreadDetail } from "../../types/thread.js";

export type GetThreadError = ThreadNotFound;

export async function getThread(
  ctx: ServiceCtx,
  id: ThreadId,
): Promise<Result<ThreadDetail, GetThreadError>> {
  const thread = await threadRepo.get(ctx, id);
  if (!thread.ok) return thread;
  const [messages, agentIds, codocIds] = await Promise.all([
    threadRepo.listMessages(ctx, id),
    threadAgentRepo.listByThread(ctx, id),
    threadCodocRepo.listByThread(ctx, id),
  ]);
  return ok({ thread: thread.value, messages, agentIds, codocIds });
}
