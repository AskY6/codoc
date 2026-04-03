import { apiFetch, apiSSE } from "./client.js";
import type { ChatThread, ChatMessage, ThreadCodoc, ThreadAgent, AgentInfo } from "../types.js";

export function createThread(
  workspaceId: string,
  title?: string,
): Promise<ChatThread> {
  return apiFetch("/chat/thread", {
    method: "POST",
    body: JSON.stringify({ workspaceId, title }),
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

export function sendMessage(
  threadId: string,
  workspaceId: string,
  content: string,
  onEvent: (eventType: string, data: unknown) => void,
  targetAgentId?: string,
): AbortController {
  return apiSSE(
    `/chat/thread/${threadId}/message`,
    { content, workspaceId, ...(targetAgentId && { targetAgentId }) },
    onEvent,
  );
}
