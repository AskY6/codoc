// set-thread-agents — reconcile the set of agents activated in a thread.

import type { AgentId, Result, ThreadId } from "@cobook/core";
import { ok } from "@cobook/core";
import type { TxAborted } from "@cobook/storage";
import type { ServiceCtx } from "../../context.js";
import { withStorageCtx } from "../../context.js";
import type { AgentNotFound, ThreadNotFound } from "../../errors.js";
import { threadAgentRepo } from "../../repo/thread-agent.js";

export interface SetThreadAgentsInput {
  readonly threadId: ThreadId;
  readonly agentIds: readonly AgentId[];
}

export type SetThreadAgentsError = ThreadNotFound | AgentNotFound | TxAborted;

export async function setThreadAgents(
  ctx: ServiceCtx,
  input: SetThreadAgentsInput,
): Promise<Result<readonly AgentId[], SetThreadAgentsError>> {
  return ctx.storage.withTransaction(async (storageCtx) => {
    const txCtx = withStorageCtx(ctx, storageCtx);
    const current = await threadAgentRepo.listByThread(txCtx, input.threadId);
    const desired = new Set(input.agentIds);
    const currentSet = new Set(current);

    const toLink = input.agentIds.filter((id) => !currentSet.has(id));
    const toUnlink = current.filter((id) => !desired.has(id));

    for (const agentId of toUnlink) {
      await threadAgentRepo.unlink(txCtx, input.threadId, agentId);
    }
    for (const agentId of toLink) {
      const r = await threadAgentRepo.link(txCtx, input.threadId, agentId);
      if (!r.ok) return r;
    }

    return ok(await threadAgentRepo.listByThread(txCtx, input.threadId));
  });
}
