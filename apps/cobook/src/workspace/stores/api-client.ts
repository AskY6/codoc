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

export async function renameDoc(docId: string, newId: string): Promise<void> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Failed to rename: ${res.status}`);
  }
}

export async function fetchDocSource(docId: string): Promise<string> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/source`);
  if (!res.ok) throw new Error(`Failed to fetch source for ${docId}: ${res.status}`);
  return res.text();
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

// --- Discover & Ingest API ---

export interface ProjectEntry {
  name: string;
  path: string;
}

export async function fetchProjects(): Promise<ProjectEntry[]> {
  const res = await fetch("/api/discover");
  if (!res.ok) throw new Error(`Failed to discover projects: ${res.status}`);
  return res.json();
}

export async function ingestProject(path: string): Promise<{ docIds: string[] }> {
  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Failed to ingest: ${res.status}`);
  return res.json();
}

// --- Connector API ---

export interface ConnectorStatus {
  name: string;
  displayName: string;
  description: string;
  active: boolean;
  authConfigured: boolean;
}

export async function fetchConnectorStatuses(): Promise<ConnectorStatus[]> {
  const res = await fetch("/api/connectors");
  if (!res.ok) throw new Error(`Failed to fetch connectors: ${res.status}`);
  return res.json();
}

export async function setConnectorActive(
  name: string,
  active: boolean,
): Promise<ConnectorStatus[]> {
  const res = await fetch("/api/connectors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, active }),
  });
  if (!res.ok) throw new Error(`Failed to update connector: ${res.status}`);
  return res.json();
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
