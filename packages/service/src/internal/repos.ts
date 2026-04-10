import {
  createWorkspaceRepository,
  createCodocRepository,
  createEdgeRepository,
  createWorkspaceAgentRepository,
  createResolvedFieldRepository,
  type DbExecutor,
  type WorkspaceRepository,
  type CodocRepository,
  type EdgeRepository,
  type WorkspaceAgentRepository,
  type ResolvedFieldRepository,
} from "@cobook/storage";

/**
 * Bundle of repositories used by every service write path.
 *
 * Built once from `db` for read paths, and rebuilt from a tx handle for each
 * write path so that every repo call inside a `withTx` callback is bound to
 * the same transaction.
 */
export interface Repos {
  workspaceRepo: WorkspaceRepository;
  codocRepo: CodocRepository;
  edgeRepo: EdgeRepository;
  workspaceAgentRepo: WorkspaceAgentRepository;
  resolvedFieldRepo: ResolvedFieldRepository;
}

export function buildRepos(exec: DbExecutor): Repos {
  return {
    workspaceRepo: createWorkspaceRepository(exec),
    codocRepo: createCodocRepository(exec),
    edgeRepo: createEdgeRepository(exec),
    workspaceAgentRepo: createWorkspaceAgentRepository(exec),
    resolvedFieldRepo: createResolvedFieldRepository(exec),
  };
}
