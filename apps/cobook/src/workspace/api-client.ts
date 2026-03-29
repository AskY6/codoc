import type { WorkspaceSnapshot, DocSnapshot, FieldAction } from "@/shared/types";

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
