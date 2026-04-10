import { parseCodoc } from "@cobook/core";
import type { ChatRepository, CodocRepository } from "@cobook/storage";
import type {
  BuildDiagnostics,
  WorkspacePresetDefinition,
  WorkspacePresetSummary,
} from "../types.js";
import { buildAiDevRadarPreset } from "./ai-dev-radar.js";

const workspacePresets: WorkspacePresetDefinition[] = [
  buildAiDevRadarPreset(),
];

export function listWorkspacePresets(): WorkspacePresetSummary[] {
  return workspacePresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    defaultWorkspaceName: preset.defaultWorkspaceName,
    tags: preset.tags,
    highlights: preset.highlights,
    agentOptions: preset.agentOptions,
    ...(preset.featured !== undefined ? { featured: preset.featured } : {}),
  }));
}

export function getWorkspacePreset(
  presetId: string,
): WorkspacePresetDefinition | undefined {
  return workspacePresets.find((preset) => preset.id === presetId);
}

export async function applyWorkspacePreset(
  workspaceId: string,
  preset: WorkspacePresetDefinition,
  deps: {
    codocRepo: CodocRepository;
    chatRepo: ChatRepository;
    buildWorkspace: (workspaceId: string) => Promise<BuildDiagnostics>;
    removeOtherCodocs?: boolean;
    agentIds?: string[];
  },
): Promise<BuildDiagnostics> {
  // Resolve agent selection up front so validation failures short-circuit
  // before any writes happen — this keeps applyPreset atomic under withTx.
  const agentIds = resolvePresetAgentIds(preset, deps.agentIds);

  const expectedPaths = new Set(preset.codocs.map((codoc) => codoc.path));

  if (deps.removeOtherCodocs) {
    const existingCodocs = await deps.codocRepo.listByWorkspace(workspaceId);
    for (const codoc of existingCodocs) {
      if (!expectedPaths.has(codoc.path)) {
        await deps.codocRepo.delete(workspaceId, codoc.path);
      }
    }
  }

  for (const codoc of preset.codocs) {
    await deps.codocRepo.upsert(workspaceId, codoc.path, {
      content: codoc.content,
      ast: parseCodoc(codoc.content),
      nodeState: "idle",
    });
  }

  const diag = await deps.buildWorkspace(workspaceId);

  await deps.chatRepo.setWorkspaceAgents(workspaceId, agentIds);

  return diag;
}

export function resolvePresetAgentIds(
  preset: WorkspacePresetDefinition,
  selectedAgentIds?: string[],
): string[] {
  const allowedAgentIds = new Set(preset.agentOptions.map((option) => option.id));

  if (selectedAgentIds) {
    if (selectedAgentIds.length === 0) {
      throw new Error("At least one preset agent must be selected");
    }

    for (const agentId of selectedAgentIds) {
      if (!allowedAgentIds.has(agentId)) {
        throw new Error(`Preset agent not allowed: ${agentId}`);
      }
    }
    return [...new Set(selectedAgentIds)];
  }

  const defaultAgentIds = preset.agentOptions
    .filter((option) => option.selectedByDefault)
    .map((option) => option.id);

  if (defaultAgentIds.length > 0) {
    return defaultAgentIds;
  }

  return preset.agentOptions.map((option) => option.id);
}
