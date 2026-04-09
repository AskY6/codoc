import { apiFetch, apiSSE } from "./client.js";
import type {
  PresetApplyProgressStep,
  Workspace,
  WorkspaceListItem,
  WorkspacePresetSummary,
  WorkspaceStatus,
} from "../types.js";

export function listWorkspaces(): Promise<WorkspaceListItem[]> {
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

export function listWorkspacePresets(): Promise<WorkspacePresetSummary[]> {
  return apiFetch("/workspace/presets");
}

export function createWorkspaceFromPreset(
  presetId: string,
  name?: string,
  agentIds?: string[],
): Promise<Workspace> {
  return apiFetch("/workspace/from-preset", {
    method: "POST",
    body: JSON.stringify({ presetId, name, agentIds }),
  });
}

export function createWorkspaceFromPresetStream(
  presetId: string,
  name: string,
  agentIds: string[],
  onEvent: (
    eventType: string,
    data:
      | { steps: PresetApplyProgressStep[] }
      | { message: string; steps: PresetApplyProgressStep[] }
      | { workspace: Workspace; steps: PresetApplyProgressStep[] },
  ) => void,
) {
  return apiSSE(
    "/workspace/from-preset/stream",
    { presetId, name, agentIds },
    (eventType, data) => {
      onEvent(
        eventType,
        data as
          | { steps: PresetApplyProgressStep[] }
          | { message: string; steps: PresetApplyProgressStep[] }
          | { workspace: Workspace; steps: PresetApplyProgressStep[] },
      );
    },
  );
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
