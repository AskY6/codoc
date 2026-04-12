// API client for /api/workspaces/:id/threads and /api/threads.
//
// Split from `workspaces.ts` because threads are their own aggregate
// even though the list / create endpoints live under a workspace
// path (standard REST nesting, mirroring `api/codocs.ts`).

import type {
  RunAgentTurnResponse,
  ThreadDetail,
  ThreadListItem,
  ThreadMessage,
} from "../types";
import { apiFetch } from "./client";

export function listThreadsByWorkspace(
  workspaceId: string,
): Promise<ThreadListItem[]> {
  return apiFetch<ThreadListItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/threads`,
  );
}

export interface CreateThreadBody {
  readonly workspaceId: string;
  readonly title: string | null;
}

export function createThread(body: CreateThreadBody): Promise<ThreadListItem> {
  const { workspaceId, title } = body;
  return apiFetch<ThreadListItem>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/threads`,
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
  );
}

export function getThread(id: string): Promise<ThreadDetail> {
  return apiFetch<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}`);
}

export function deleteThread(id: string): Promise<void> {
  return apiFetch<void>(`/api/threads/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface AppendUserMessageBody {
  readonly threadId: string;
  readonly content: string;
}

export function appendUserMessage(
  body: AppendUserMessageBody,
): Promise<ThreadMessage> {
  const { threadId, content } = body;
  return apiFetch<ThreadMessage>(
    `/api/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
}

export interface SetThreadAgentsBody {
  readonly threadId: string;
  readonly agentIds: readonly string[];
}

export function setThreadAgents(
  body: SetThreadAgentsBody,
): Promise<{ agentIds: string[] }> {
  const { threadId, agentIds } = body;
  return apiFetch<{ agentIds: string[] }>(
    `/api/threads/${encodeURIComponent(threadId)}/agents`,
    {
      method: "PUT",
      body: JSON.stringify({ agentIds }),
    },
  );
}

export interface SetThreadCodocsBody {
  readonly threadId: string;
  readonly codocIds: readonly string[];
}

export function setThreadCodocs(
  body: SetThreadCodocsBody,
): Promise<{ codocIds: string[] }> {
  const { threadId, codocIds } = body;
  return apiFetch<{ codocIds: string[] }>(
    `/api/threads/${encodeURIComponent(threadId)}/codocs`,
    {
      method: "PUT",
      body: JSON.stringify({ codocIds }),
    },
  );
}

export interface RunAgentTurnInput {
  readonly threadId: string;
  readonly content: string;
}

export function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<RunAgentTurnResponse> {
  const { threadId, content } = input;
  return apiFetch<RunAgentTurnResponse>(
    `/api/threads/${encodeURIComponent(threadId)}/turn`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
}

export interface ConfirmToolCallBody {
  readonly threadId: string;
  readonly requestId: string;
  readonly approved: boolean;
}

export function confirmToolCall(
  body: ConfirmToolCallBody,
): Promise<{ ok: boolean }> {
  const { threadId, requestId, approved } = body;
  return apiFetch<{ ok: boolean }>(
    `/api/threads/${encodeURIComponent(threadId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ requestId, approved }),
    },
  );
}
