import type { WorkspaceSnapshot, DocSnapshot, FieldAction } from "@/shared/types";

// --- Workspace API ---

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

// --- Chat API ---

export interface ChatMessage {
  id: string;
  sender: { id: string; kind: "human" | "agent" };
  content: string;
  quotedIds?: string[];
  resourceRefs?: Array<{ kind: string; id: string; label?: string }>;
  mentionedParticipants?: string[];
  intents?: Array<{
    kind: string;
    payload: unknown;
    status: "proposed" | "confirmed" | "rejected";
  }>;
  timestamp: number;
}

export interface ChatParticipant {
  id: string;
  kind: "human" | "agent";
  name: string;
  description: string;
}

export async function fetchChatState(): Promise<{
  messages: ChatMessage[];
  participants: ChatParticipant[];
  resources: Array<{ kind: string; id: string; label?: string }>;
}> {
  const res = await fetch("/api/chat");
  if (!res.ok) throw new Error(`Failed to fetch chat state: ${res.status}`);
  return res.json();
}

export async function sendChatMessage(
  content: string,
  opts?: {
    mentionedParticipants?: string[];
    resourceRefs?: Array<{ kind: string; id: string; label?: string }>;
  },
): Promise<ChatMessage> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      mentionedParticipants: opts?.mentionedParticipants,
      resourceRefs: opts?.resourceRefs,
    }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
  return res.json();
}

export async function updateIntent(
  msgId: string,
  intentIdx: number,
  status: "confirmed" | "rejected",
): Promise<void> {
  const res = await fetch("/api/chat/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgId, intentIdx, status }),
  });
  if (!res.ok) throw new Error(`Failed to update intent: ${res.status}`);
}

export async function addReference(ref: {
  kind: string;
  id: string;
  label?: string;
}): Promise<void> {
  const res = await fetch("/api/chat/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ref),
  });
  if (!res.ok) throw new Error(`Failed to add reference: ${res.status}`);
}

export async function removeReference(refId: string): Promise<void> {
  const res = await fetch(
    `/api/chat/reference?id=${encodeURIComponent(refId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Failed to remove reference: ${res.status}`);
}
