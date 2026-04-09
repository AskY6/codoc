import { apiFetch } from "./client.js";
import type { Workspace, WorkspaceStatus } from "../types.js";

export function listWorkspaces(): Promise<Workspace[]> {
  return apiFetch("/workspace");
}

export function getWorkspace(id: string): Promise<Workspace> {
  return apiFetch(`/workspace/${id}`);
}

export function getWorkspaceStatus(id: string): Promise<WorkspaceStatus> {
  return apiFetch(`/workspace/${id}/status`);
}

export function createWorkspace(name: string): Promise<Workspace> {
  return apiFetch("/workspace", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateWorkspace(
  id: string,
  data: { name?: string; description?: string | null },
): Promise<Workspace> {
  return apiFetch(`/workspace/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWorkspace(id: string): Promise<{ ok: true }> {
  return apiFetch(`/workspace/${id}`, { method: "DELETE" });
}
