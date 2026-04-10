import { parseCodoc, patchCodocSource } from "@cobook/core";
import type { Codoc } from "@cobook/storage";
import type { Repos } from "./internal/repos.js";
import {
  deriveCodocState,
  fieldsToResolvedData,
  groupFieldsByCodoc,
} from "./internal/field-helpers.js";
import {
  parseCodocAstSafe,
  parseCodocMetaSafe,
} from "./internal/ast-helpers.js";
import type { BuildService } from "./build-service.js";
import type { BuildDiagnostics, CodocInfo, CodocListItem } from "./types.js";

// ---------------------------------------------------------------------------
// CodocService
//
// Owns codoc CRUD. Every write path triggers a rebuild within the same
// transaction (via `buildService.buildImpl`) and invalidates the DAG cache
// after the transaction commits.
// ---------------------------------------------------------------------------

export interface CodocService {
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
  listCodocs(workspaceId: string): Promise<CodocListItem[]>;
}

export interface CodocServiceDeps {
  defaultRepos: Repos;
  withTx: <T>(fn: (repos: Repos) => Promise<T>) => Promise<T>;
  buildService: BuildService;
}

export function createCodocService(deps: CodocServiceDeps): CodocService {
  const { defaultRepos, withTx, buildService } = deps;

  // -----------------------------------------------------------------------
  // Tx-composable impls
  // -----------------------------------------------------------------------

  async function createCodocImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<BuildDiagnostics> {
    // Parse first — reject invalid YAML/structure up front so callers get a
    // structured error instead of a persisted-but-broken codoc.
    parseCodoc(content);
    await repos.codocRepo.upsert(workspaceId, path, { content });
    return buildService.buildImpl(repos, workspaceId);
  }

  async function updateCodocImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<BuildDiagnostics> {
    parseCodoc(newContent);
    await repos.codocRepo.upsert(workspaceId, path, { content: newContent });
    return buildService.buildImpl(repos, workspaceId);
  }

  async function deleteCodocImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
  ): Promise<BuildDiagnostics> {
    await repos.codocRepo.delete(workspaceId, path);
    return buildService.buildImpl(repos, workspaceId);
  }

  async function patchCodocDataImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
    dataPath: string,
    value: unknown,
  ): Promise<BuildDiagnostics> {
    const row = await repos.codocRepo.findByPath(workspaceId, path);
    if (!row) throw new Error(`Codoc not found: ${path}`);
    const newContent = patchCodocSource(row.content, dataPath, value);
    return updateCodocImpl(repos, workspaceId, path, newContent);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async function createCodoc(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<void> {
    const result = await withTx((repos) =>
      createCodocImpl(repos, workspaceId, path, content),
    );
    buildService.invalidate(workspaceId, result.dag);
  }

  async function updateCodoc(
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<void> {
    const result = await withTx((repos) =>
      updateCodocImpl(repos, workspaceId, path, newContent),
    );
    buildService.invalidate(workspaceId, result.dag);
  }

  async function deleteCodoc(
    workspaceId: string,
    path: string,
  ): Promise<void> {
    const result = await withTx((repos) =>
      deleteCodocImpl(repos, workspaceId, path),
    );
    buildService.invalidate(workspaceId, result.dag);
  }

  async function patchCodocData(
    workspaceId: string,
    path: string,
    dataPath: string,
    value: unknown,
  ): Promise<void> {
    const result = await withTx((repos) =>
      patchCodocDataImpl(repos, workspaceId, path, dataPath, value),
    );
    buildService.invalidate(workspaceId, result.dag);
  }

  async function getCodoc(
    workspaceId: string,
    path: string,
  ): Promise<CodocInfo | undefined> {
    const row = await defaultRepos.codocRepo.findByPath(workspaceId, path);
    if (!row) return undefined;

    const fields = await defaultRepos.resolvedFieldRepo.listByCodoc(row.id);
    const resolvedData = fieldsToResolvedData(fields);
    return {
      path: row.path,
      content: row.content,
      ast: parseCodocAstSafe(row.content),
      resolvedData:
        Object.keys(resolvedData).length === 0 ? null : resolvedData,
      nodeState: deriveCodocState(fields),
    };
  }

  async function getCodocById(id: string): Promise<Codoc | undefined> {
    return defaultRepos.codocRepo.findById(id);
  }

  async function listCodocs(workspaceId: string): Promise<CodocListItem[]> {
    const [all, fields] = await Promise.all([
      defaultRepos.codocRepo.listByWorkspace(workspaceId),
      defaultRepos.resolvedFieldRepo.listByWorkspace(workspaceId),
    ]);
    const byCodoc = groupFieldsByCodoc(fields);
    return all.map((c) => {
      const item: CodocListItem = {
        id: c.id,
        path: c.path,
        nodeState: deriveCodocState(byCodoc.get(c.id) ?? []),
        meta: {},
      };
      const meta = parseCodocMetaSafe(c.content);
      if (meta) {
        if (typeof meta.title === "string") item.meta.title = meta.title;
        if (typeof meta.description === "string")
          item.meta.description = meta.description;
        if (Array.isArray(meta.tags)) item.meta.tags = meta.tags;
      }
      return item;
    });
  }

  return {
    createCodoc,
    updateCodoc,
    deleteCodoc,
    getCodoc,
    getCodocById,
    patchCodocData,
    listCodocs,
  };
}
