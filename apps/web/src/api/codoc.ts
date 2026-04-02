import { apiFetch } from "./client.js";
import type { CodocListItem, CodocDetail } from "../types.js";

export function listCodocs(workspaceId: string): Promise<CodocListItem[]> {
  return apiFetch(`/workspace/${workspaceId}/codocs`);
}

export function getCodoc(
  workspaceId: string,
  path: string,
): Promise<CodocDetail> {
  return apiFetch(`/workspace/${workspaceId}/codoc/${path}`);
}

export function createCodoc(
  workspaceId: string,
  path: string,
  content: string,
): Promise<{ ok: true }> {
  return apiFetch(`/workspace/${workspaceId}/codoc`, {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}

export function updateCodoc(
  workspaceId: string,
  path: string,
  content: string,
): Promise<{ ok: true }> {
  return apiFetch(`/workspace/${workspaceId}/codoc/${path}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export function deleteCodoc(
  workspaceId: string,
  path: string,
): Promise<{ ok: true }> {
  return apiFetch(`/workspace/${workspaceId}/codoc/${path}`, {
    method: "DELETE",
  });
}
