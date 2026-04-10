import type { Workspace } from "@cobook/storage";
import type { Repos } from "./internal/repos.js";
import type { BuildService } from "./build-service.js";
import {
  applyWorkspacePreset,
  getWorkspacePreset,
  listWorkspacePresets,
} from "./presets/index.js";
import type { BuildDiagnostics, WorkspacePresetSummary } from "./types.js";

// ---------------------------------------------------------------------------
// PresetService
//
// Applies preset definitions (seed codocs + workspace-agent selection) to
// workspaces. All writes are transactional and trigger a rebuild via
// `buildService.buildImpl`.
// ---------------------------------------------------------------------------

export interface PresetService {
  listPresets(): WorkspacePresetSummary[];
  applyPreset(
    workspaceId: string,
    presetId: string,
    agentIds?: string[],
  ): Promise<void>;
  createWorkspaceFromPreset(
    presetId: string,
    name?: string,
    agentIds?: string[],
  ): Promise<Workspace>;
}

export interface PresetServiceDeps {
  withTx: <T>(fn: (repos: Repos) => Promise<T>) => Promise<T>;
  buildService: BuildService;
}

export function createPresetService(deps: PresetServiceDeps): PresetService {
  const { withTx, buildService } = deps;

  async function applyPresetImpl(
    repos: Repos,
    workspaceId: string,
    presetId: string,
    agentIds?: string[],
  ): Promise<BuildDiagnostics> {
    const preset = getWorkspacePreset(presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    return applyWorkspacePreset(workspaceId, preset, {
      codocRepo: repos.codocRepo,
      workspaceAgentRepo: repos.workspaceAgentRepo,
      buildWorkspace: (wid) => buildService.buildImpl(repos, wid),
      ...(agentIds ? { agentIds } : {}),
    });
  }

  function listPresets(): WorkspacePresetSummary[] {
    return listWorkspacePresets();
  }

  async function applyPreset(
    workspaceId: string,
    presetId: string,
    agentIds?: string[],
  ): Promise<void> {
    const result = await withTx((repos) =>
      applyPresetImpl(repos, workspaceId, presetId, agentIds),
    );
    buildService.invalidate(workspaceId, result.dag);
  }

  async function createWorkspaceFromPreset(
    presetId: string,
    name?: string,
    agentIds?: string[],
  ): Promise<Workspace> {
    const preset = getWorkspacePreset(presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    const { workspace, dag } = await withTx(async (repos) => {
      const created = await repos.workspaceRepo.create({
        name: name?.trim() || preset.defaultWorkspaceName,
        description: preset.workspaceDescription,
      });
      const result = await applyPresetImpl(
        repos,
        created.id,
        presetId,
        agentIds,
      );
      return { workspace: created, dag: result.dag };
    });
    buildService.invalidate(workspace.id, dag);
    return workspace;
  }

  return {
    listPresets,
    applyPreset,
    createWorkspaceFromPreset,
  };
}
