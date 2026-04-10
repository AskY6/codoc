import {
  createAgentSessionRepository,
  type Database,
  type Codoc,
  type Workspace,
  type WorkspaceListItem,
  type WorkspaceAgent,
  type AgentSessionRepository,
} from "@cobook/storage";
import { buildRepos, type Repos } from "./internal/repos.js";
import { createBuildService } from "./build-service.js";
import { createCodocService } from "./codoc-service.js";
import { createPresetService } from "./preset-service.js";
import type {
  BuildDiagnostics,
  CodocInfo,
  CodocListItem,
  WorkspaceGraph,
  WorkspacePresetSummary,
  WorkspaceStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// WorkspaceService — facade
//
// The public service surface is a single object so routes only depend on
// `WorkspaceService`. Internally it composes 3 sub-services (build / codoc /
// preset) that share a `Repos` bundle and a `withTx` helper, plus the
// workspace-level CRUD that this file owns directly.
// ---------------------------------------------------------------------------

export interface WorkspaceServiceDeps {
  db: Database;
}

export interface WorkspaceService {
  // Workspace CRUD
  createWorkspace(
    name: string,
    description?: string | null,
  ): Promise<Workspace>;
  listWorkspaces(): Promise<WorkspaceListItem[]>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  updateWorkspace(
    id: string,
    data: { name?: string; description?: string | null },
  ): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  // Presets
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
  listPresets(): WorkspacePresetSummary[];

  // Build / resolve
  build(workspaceId: string): Promise<BuildDiagnostics>;
  resolve(workspaceId: string, nodeId: string): Promise<unknown>;
  getStatus(workspaceId: string): Promise<WorkspaceStatus>;
  getGraph(workspaceId: string): Promise<WorkspaceGraph>;

  // Codoc CRUD
  listCodocs(workspaceId: string): Promise<CodocListItem[]>;
  createCodoc(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<void>;
  updateCodoc(
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<void>;
  deleteCodoc(workspaceId: string, path: string): Promise<void>;
  getCodoc(
    workspaceId: string,
    path: string,
  ): Promise<CodocInfo | undefined>;
  getCodocById(id: string): Promise<Codoc | undefined>;
  patchCodocData(
    workspaceId: string,
    path: string,
    dataPath: string,
    value: unknown,
  ): Promise<void>;

  // Workspace-agent bindings
  setWorkspaceAgents(
    workspaceId: string,
    agentIds: string[],
  ): Promise<void>;
  getWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]>;

  /**
   * Repository used by the agent runtime to persist scene state during
   * `agent.run()`. Exposed on the service so that HTTP routes don't need
   * to wire storage dependencies themselves.
   */
  readonly agentSessionRepo: AgentSessionRepository;
}

export function createWorkspaceService(
  deps: WorkspaceServiceDeps,
): WorkspaceService {
  const { db } = deps;

  // Default (non-tx) repos for read paths; every write path builds a fresh
  // bundle bound to the transaction.
  const defaultRepos = buildRepos(db);

  // Agent session repo lives outside `Repos` — it's only touched by the
  // agent runtime during `agent.run()`, never inside a service write
  // transaction.
  const agentSessionRepo = createAgentSessionRepository(db);

  // Run fn inside a pg transaction. Drizzle rolls back on thrown errors.
  async function withTx<T>(fn: (repos: Repos) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(buildRepos(tx)));
  }

  // -----------------------------------------------------------------------
  // Sub-services
  // -----------------------------------------------------------------------

  const buildService = createBuildService({ defaultRepos, withTx });
  const codocService = createCodocService({
    defaultRepos,
    withTx,
    buildService,
  });
  const presetService = createPresetService({ withTx, buildService });

  // -----------------------------------------------------------------------
  // Workspace-level CRUD (owned by the facade)
  // -----------------------------------------------------------------------

  async function createWorkspace(
    name: string,
    description?: string | null,
  ): Promise<Workspace> {
    // Single insert — a one-statement "transaction" is fine, no withTx needed.
    if (description !== undefined && description !== null) {
      return defaultRepos.workspaceRepo.create({ name, description });
    }
    return defaultRepos.workspaceRepo.create({ name });
  }

  async function listWorkspaces(): Promise<WorkspaceListItem[]> {
    return defaultRepos.workspaceRepo.listWithStats();
  }

  async function getWorkspace(id: string): Promise<Workspace | undefined> {
    return defaultRepos.workspaceRepo.findById(id);
  }

  async function updateWorkspace(
    id: string,
    data: { name?: string; description?: string | null },
  ): Promise<Workspace> {
    return defaultRepos.workspaceRepo.update(id, data);
  }

  async function deleteWorkspace(id: string): Promise<void> {
    // FK cascades handle codocs / edges / threads / agents — a single
    // DELETE is sufficient.
    await defaultRepos.workspaceRepo.delete(id);
  }

  // -----------------------------------------------------------------------
  // Facade — delegate to sub-services
  // -----------------------------------------------------------------------

  return {
    // Workspace CRUD
    createWorkspace,
    listWorkspaces,
    getWorkspace,
    updateWorkspace,
    deleteWorkspace,

    // Presets
    applyPreset: presetService.applyPreset,
    createWorkspaceFromPreset: presetService.createWorkspaceFromPreset,
    listPresets: presetService.listPresets,

    // Build / resolve
    build: buildService.build,
    resolve: buildService.resolve,
    getStatus: buildService.getStatus,
    getGraph: buildService.getGraph,

    // Codoc CRUD
    listCodocs: codocService.listCodocs,
    createCodoc: codocService.createCodoc,
    updateCodoc: codocService.updateCodoc,
    deleteCodoc: codocService.deleteCodoc,
    getCodoc: codocService.getCodoc,
    getCodocById: codocService.getCodocById,
    patchCodocData: codocService.patchCodocData,

    // Workspace-agent bindings
    setWorkspaceAgents: (workspaceId, agentIds) =>
      defaultRepos.workspaceAgentRepo.setForWorkspace(workspaceId, agentIds),
    getWorkspaceAgents: (workspaceId) =>
      defaultRepos.workspaceAgentRepo.listByWorkspace(workspaceId),

    agentSessionRepo,
  };
}
