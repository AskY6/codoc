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

export function createWorkspace(rootPath: string): Promise<Workspace> {
  return apiFetch("/workspace", {
    method: "POST",
    body: JSON.stringify({ rootPath }),
  });
}

export function deleteWorkspace(id: string): Promise<{ ok: true }> {
  return apiFetch(`/workspace/${id}`, { method: "DELETE" });
}
