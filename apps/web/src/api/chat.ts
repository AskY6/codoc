import { apiFetch, apiSSE } from "./client.js";
import type { ChatThread, ChatMessage } from "../types.js";

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

export function sendMessage(
  threadId: string,
  workspaceId: string,
  content: string,
  onEvent: (eventType: string, data: unknown) => void,
): AbortController {
  return apiSSE(`/chat/thread/${threadId}/message`, { content, workspaceId }, onEvent);
}
