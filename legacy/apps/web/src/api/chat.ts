import { apiFetch, apiSSE, apiSSEGet } from "./client.js";
import type { ChatThread, ChatMessage, ThreadCodoc, ThreadAgent, AgentInfo, WorkspaceAgent, ViewActionContext } from "../types.js";

export function createThread(
  workspaceId: string,
  options?: { title?: string; agentIds?: string[]; codocIds?: string[] },
): Promise<ChatThread> {
  return apiFetch("/chat/thread", {
    method: "POST",
    body: JSON.stringify({ workspaceId, ...options }),
  });
}

export function getThread(
  threadId: string,
): Promise<{ thread: ChatThread; messages: ChatMessage[] }> {
  return apiFetch(`/chat/thread/${threadId}`);
}

export function listThreads(workspaceId: string): Promise<ChatThread[]> {
  return apiFetch(`/chat/threads?workspaceId=${workspaceId}`);
}

export function updateThread(
  threadId: string,
  data: { title?: string },
): Promise<ChatThread> {
  return apiFetch(`/chat/thread/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteThread(threadId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/chat/thread/${threadId}`, { method: "DELETE" });
}

export function setThreadCodocs(
  threadId: string,
  codocIds: string[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/chat/thread/${threadId}/codocs`, {
    method: "PUT",
    body: JSON.stringify({ codocIds }),
  });
}

export function getThreadCodocs(threadId: string): Promise<ThreadCodoc[]> {
  return apiFetch(`/chat/thread/${threadId}/codocs`);
}

export function setThreadAgents(
  threadId: string,
  agentIds: string[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/chat/thread/${threadId}/agents`, {
    method: "PUT",
    body: JSON.stringify({ agentIds }),
  });
}

export function getThreadAgents(threadId: string): Promise<ThreadAgent[]> {
  return apiFetch(`/chat/thread/${threadId}/agents`);
}

export function listAgents(): Promise<AgentInfo[]> {
  return apiFetch("/chat/agents");
}

export function getWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]> {
  return apiFetch(`/chat/workspace/${workspaceId}/agents`);
}

export function setWorkspaceAgents(
  workspaceId: string,
  agentIds: string[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/chat/workspace/${workspaceId}/agents`, {
    method: "PUT",
    body: JSON.stringify({ agentIds }),
  });
}

export interface SendMessageOptions {
  targetAgentId?: string;
  context?: ViewActionContext;
}

export function sendMessage(
  threadId: string,
  workspaceId: string,
  content: string,
  onEvent: (eventType: string, data: unknown) => void,
  options?: SendMessageOptions,
): AbortController {
  const { targetAgentId, context } = options ?? {};
  return apiSSE(
    `/chat/thread/${threadId}/message`,
    {
      content,
      workspaceId,
      ...(targetAgentId && { targetAgentId }),
      ...(context && { context }),
    },
    onEvent,
  );
}

export function reconnectStream(
  threadId: string,
  onEvent: (eventType: string, data: unknown) => void,
): Promise<AbortController | null> {
  return apiSSEGet(`/chat/thread/${threadId}/stream`, onEvent);
}
