import type { WorkspaceSnapshot, DocSnapshot, FieldAction } from "./types";
import type { ChatStore, WritePreview } from "./chat-store";

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const res = await fetch("/api/workspace");
  if (!res.ok) throw new Error(`Failed to fetch workspace: ${res.status}`);
  return res.json();
}

export async function fetchDoc(docId: string): Promise<DocSnapshot> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`);
  if (!res.ok) throw new Error(`Failed to fetch doc ${docId}: ${res.status}`);
  return res.json();
}

export async function forceDoc(docId: string): Promise<void> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/force`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to force doc ${docId}: ${res.status}`);
}

export async function fieldAction(docId: string, action: FieldAction): Promise<void> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/field`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!res.ok) throw new Error(`Field action failed: ${res.status}`);
}

export async function createDoc(docId: string, content: string): Promise<void> {
  const res = await fetch("/api/docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, content }),
  });
  if (!res.ok) throw new Error(`Failed to create doc: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

/**
 * Read an SSE stream of `data: {text}` chunks and feed them into a
 * ChatStore message, accumulating content in real-time.
 */
export async function streamIntoMessage(
  response: Response,
  store: ChatStore,
  messageId: string,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as {
          text?: string;
          error?: string;
          write?: WritePreview;
        };
        if (parsed.error) {
          store.updateMessageContent(messageId, accumulated + `\n\n**Error:** ${parsed.error}`);
          return;
        }
        if (parsed.text) {
          accumulated += parsed.text;
          store.updateMessageContent(messageId, accumulated);
        }
        if (parsed.write) {
          store.setPreview(messageId, parsed.write);
        }
      } catch {
        /* skip malformed */
      }
    }
  }
}

/**
 * Invoke a preset agent via SSE and stream the result into a chat message.
 */
export async function invokeAgentStream(
  agentId: string,
  docIds: string[],
  store: ChatStore,
  messageId: string,
  extraPrompt?: string,
): Promise<void> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, docIds, extraPrompt }),
  });
  if (!res.ok) {
    const body = await res.text();
    store.updateMessageContent(messageId, `**Error:** ${body}`);
    return;
  }
  await streamIntoMessage(res, store, messageId);
}

/**
 * Send a chat message and stream the response.
 */
export async function chatStream(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  store: ChatStore,
  messageId: string,
  system?: string,
  references?: string[],
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system, references }),
  });
  if (!res.ok) {
    const body = await res.text();
    store.updateMessageContent(messageId, `**Error:** ${body}`);
    return;
  }
  await streamIntoMessage(res, store, messageId);
}
