// API client for /api/workspaces/:id/codocs and /api/codocs.
//
// Split from `workspaces.ts` because codocs are their own aggregate
// even though the list / create endpoints live under a workspace
// path (standard REST nesting).

import type { CodocDetail, CodocListItem } from "../types";
import { apiFetch } from "./client";

export function listCodocsByWorkspace(
  workspaceId: string,
): Promise<CodocListItem[]> {
  return apiFetch<CodocListItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/codocs`,
  );
}

export interface CreateCodocBody {
  readonly workspaceId: string;
  readonly path: string;
  readonly title: string | null;
}

export function createCodoc(body: CreateCodocBody): Promise<CodocListItem> {
  const { workspaceId, path, title } = body;
  return apiFetch<CodocListItem>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/codocs`,
    {
      method: "POST",
      body: JSON.stringify({ path, title }),
    },
  );
}

export function getCodoc(id: string): Promise<CodocDetail> {
  return apiFetch<CodocDetail>(`/api/codocs/${encodeURIComponent(id)}`);
}

export interface UpdateCodocContentBody {
  readonly id: string;
  readonly content: string;
  readonly expectedRev: string;
}

export function updateCodocContent(
  body: UpdateCodocContentBody,
): Promise<CodocDetail> {
  const { id, ...rest } = body;
  return apiFetch<CodocDetail>(`/api/codocs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(rest),
  });
}

export function deleteCodoc(id: string): Promise<void> {
  return apiFetch<void>(`/api/codocs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
