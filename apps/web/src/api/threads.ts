// API client for /api/workspaces/:id/threads and /api/threads.
//
// Split from `workspaces.ts` because threads are their own aggregate
// even though the list / create endpoints live under a workspace
// path (standard REST nesting, mirroring `api/codocs.ts`).

import type { ThreadDetail, ThreadListItem, ThreadMessage } from "../types";
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
