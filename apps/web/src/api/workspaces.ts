// API client for /api/workspaces. One function per route.

import type { Workspace, WorkspaceListItem } from "../types";
import { apiFetch } from "./client";

export function listWorkspaces(): Promise<WorkspaceListItem[]> {
  return apiFetch<WorkspaceListItem[]>("/api/workspaces");
}

export interface CreateWorkspaceBody {
  readonly name: string;
  readonly description: string | null;
}

export function createWorkspace(body: CreateWorkspaceBody): Promise<Workspace> {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteWorkspace(id: string): Promise<void> {
  return apiFetch<void>(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
