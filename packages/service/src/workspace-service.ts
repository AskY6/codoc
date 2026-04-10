import {
  parseCodoc,
  patchCodocSource,
  buildDAG,
  topoSort,
  detectCycles,
  validateRefs,
  isClientSource,
  type CodocAST,
  type DAG,
  ParseError,
} from "@cobook/core";
import {
  createWorkspaceRepository,
  createCodocRepository,
  createEdgeRepository,
  createChatRepository,
  createAgentSessionRepository,
  createResolvedFieldRepository,
  type Database,
  type DbExecutor,
  type WorkspaceRepository,
  type CodocRepository,
  type Codoc,
  type EdgeRepository,
  type Workspace,
  type WorkspaceListItem,
  type ChatRepository,
  type AgentSessionRepository,
  type ResolvedField,
  type ResolvedFieldRepository,
  type ResolvedFieldState,
} from "@cobook/storage";
import { executeSource } from "./source-executor.js";
import {
  applyWorkspacePreset,
  getWorkspacePreset,
  listWorkspacePresets,
} from "./presets/index.js";
import type {
  BuildDiagnostics,
  CodocInfo,
  CodocListItem,
  DiagnosticError,
  WorkspaceGraph,
  WorkspacePresetSummary,
  WorkspaceStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal repo bundle — built once from `db` for reads, and rebuilt from a
// tx handle for each write path.
// ---------------------------------------------------------------------------

interface Repos {
  workspaceRepo: WorkspaceRepository;
  codocRepo: CodocRepository;
  edgeRepo: EdgeRepository;
  chatRepo: ChatRepository;
  resolvedFieldRepo: ResolvedFieldRepository;
}

function buildRepos(exec: DbExecutor): Repos {
  return {
    workspaceRepo: createWorkspaceRepository(exec),
    codocRepo: createCodocRepository(exec),
    edgeRepo: createEdgeRepository(exec),
    chatRepo: createChatRepository(exec),
    resolvedFieldRepo: createResolvedFieldRepository(exec),
  };
}

// ---------------------------------------------------------------------------
// Per-field state helpers
//
// `codoc_resolved_fields` is the source of truth for a codoc's state: the
// service layer derives a codoc-level aggregate for the UI by scanning its
// rows. Parse errors are recorded as a synthetic field with a reserved
// `#$parse` suffix so the derivation logic has something to aggregate.
// ---------------------------------------------------------------------------

const PARSE_ERROR_SUFFIX = "#$parse";

function parseErrorNodeId(path: string): string {
  return `${path}${PARSE_ERROR_SUFFIX}`;
}

function isSyntheticFieldNodeId(nodeId: string): boolean {
  return nodeId.endsWith(PARSE_ERROR_SUFFIX);
}

function deriveCodocState(fields: ResolvedField[]): string {
  for (const f of fields) {
    if (f.state === "error") return "error";
  }
  return "ready";
}

function groupFieldsByCodoc(
  fields: ResolvedField[],
): Map<string, ResolvedField[]> {
  const byCodoc = new Map<string, ResolvedField[]>();
  for (const f of fields) {
    let bucket = byCodoc.get(f.codocId);
    if (!bucket) {
      bucket = [];
      byCodoc.set(f.codocId, bucket);
    }
    bucket.push(f);
  }
  return byCodoc;
}

/**
 * Collapse a codoc's resolved field rows into a flat `{ nodeId: value }` map
 * matching the old `resolvedValue` contract. Synthetic parse-error rows are
 * skipped — they exist only to drive state aggregation.
 */
function fieldsToResolvedData(
  fields: ResolvedField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (isSyntheticFieldNodeId(f.nodeId)) continue;
    out[f.nodeId] = f.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WorkspaceServiceDeps {
  db: Database;
}

export interface WorkspaceService {
  createWorkspace(name: string, description?: string | null): Promise<Workspace>;
  listWorkspaces(): Promise<WorkspaceListItem[]>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  deleteWorkspace(id: string): Promise<void>;
  applyPreset(workspaceId: string, presetId: string, agentIds?: string[]): Promise<void>;
  createWorkspaceFromPreset(
    presetId: string,
    name?: string,
    agentIds?: string[],
  ): Promise<Workspace>;
  listPresets(): WorkspacePresetSummary[];
  updateWorkspace(id: string, data: { name?: string; description?: string | null }): Promise<Workspace>;
  getStatus(workspaceId: string): Promise<WorkspaceStatus>;
  listCodocs(workspaceId: string): Promise<CodocListItem[]>;
  build(workspaceId: string): Promise<BuildDiagnostics>;
  resolve(workspaceId: string, nodeId: string): Promise<unknown>;
  getGraph(workspaceId: string): Promise<WorkspaceGraph>;
  createCodoc(workspaceId: string, path: string, content: string): Promise<void>;
  updateCodoc(workspaceId: string, path: string, newContent: string): Promise<void>;
  deleteCodoc(workspaceId: string, path: string): Promise<void>;
  getCodoc(workspaceId: string, path: string): Promise<CodocInfo | undefined>;
  getCodocById(id: string): Promise<Codoc | undefined>;
  patchCodocData(workspaceId: string, path: string, dataPath: string, value: unknown): Promise<void>;
  /**
   * Repository used by the agent runtime to persist scene state during
   * `agent.run()`. Exposed on the service so that HTTP routes don't need
   * to wire storage dependencies themselves.
   */
  readonly agentSessionRepo: AgentSessionRepository;
}

export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService {
  const { db } = deps;

  // Default (non-tx) repos for read paths.
  const defaultRepos = buildRepos(db);
  // Agent session repo lives outside `Repos` — it's only touched by the agent
  // runtime during `agent.run()`, never inside a service write transaction.
  const agentSessionRepo = createAgentSessionRepository(db);

  // In-memory DAG cache keyed by workspaceId — rebuilt on build(). Only
  // updated by public write wrappers *after* the surrounding transaction
  // commits, so a rollback cannot leave stale DAG state in the cache.
  const dagCache = new Map<string, DAG>();

  // Run fn inside a pg transaction. Drizzle rolls back on thrown errors.
  async function withTx<T>(fn: (repos: Repos) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(buildRepos(tx)));
  }

  // -----------------------------------------------------------------------
  // build — parametric on Repos so it composes cleanly inside a tx
  // -----------------------------------------------------------------------

  async function buildImpl(
    repos: Repos,
    workspaceId: string,
  ): Promise<BuildDiagnostics> {
    const { codocRepo, edgeRepo, resolvedFieldRepo } = repos;
    const rows = await codocRepo.listByWorkspace(workspaceId);
    const errors: DiagnosticError[] = [];
    const codocMap = new Map<string, CodocAST>();
    const pathToId = new Map<string, string>();

    // 1. Parse all codocs from their source content. The AST is never cached
    // on the row — `content` is the sole source of truth.
    for (const row of rows) {
      pathToId.set(row.path, row.id);
      try {
        const ast = parseCodoc(row.content);
        codocMap.set(row.path, ast);
      } catch (err) {
        const msg = err instanceof ParseError ? err.message : String(err);
        errors.push({ kind: "parse-error", message: msg, path: row.path });
        // Record the parse failure as a synthetic field row so the derived
        // codoc state surfaces 'error' via the standard aggregation path.
        await resolvedFieldRepo.replaceForCodoc(workspaceId, row.id, [
          { nodeId: parseErrorNodeId(row.path), value: null, state: "error" },
        ]);
      }
    }

    // 2. Build DAG
    const dag = buildDAG(codocMap);

    // 3. Detect cycles
    const cycles = detectCycles(dag);
    for (const cycle of cycles) {
      errors.push({
        kind: "cycle",
        message: `Circular dependency: ${cycle.join(" → ")}`,
        nodes: cycle,
      });
    }

    // 4. Validate refs
    const refResult = validateRefs(dag);
    for (const refErr of refResult.errors) {
      errors.push({
        kind: "broken-ref",
        message: refErr.message,
        nodes: [refErr.from, refErr.to],
      });
    }

    // 5. Persist edges (physical materialized view — not used for execution)
    const edgeData = dag.edges.map((e) => ({ fromNodeId: e.from, toNodeId: e.to }));
    await edgeRepo.replaceAll(workspaceId, edgeData);

    // 6. Write per-field rows for every DAG node, partitioned by codoc.
    //    `replaceForCodoc` is destructive: it wipes the prior row set and
    //    inserts this build's canonical set. Stale node_ids are evicted for
    //    free — no "read prev → merge → clean" glue.
    const cycleNodes = new Set(cycles.flat());
    const brokenRefNodes = new Set(refResult.errors.map((e) => e.from));

    const codocFields = new Map<
      string,
      { nodeId: string; value: unknown; state: ResolvedFieldState }[]
    >();
    // Seed with an empty array for every successfully-parsed codoc so that a
    // codoc with zero data nodes still has its stale rows cleared.
    for (const path of codocMap.keys()) {
      codocFields.set(path, []);
    }
    for (const [nodeId, node] of dag.nodes) {
      const bucket = codocFields.get(node.codocPath);
      if (!bucket) continue;
      const hasError = cycleNodes.has(nodeId) || brokenRefNodes.has(nodeId);
      const state: ResolvedFieldState = hasError ? "error" : "ready";
      // Only static fields have a computed value at build time. Ref and
      // source fields are populated on demand by resolveNode — which
      // upserts the individual row with its actual value.
      const value = node.field.kind === "static" ? node.field.value : null;
      bucket.push({ nodeId, value, state });
    }

    for (const [codocPath, fields] of codocFields) {
      const codocId = pathToId.get(codocPath);
      if (!codocId) continue;
      await resolvedFieldRepo.replaceForCodoc(workspaceId, codocId, fields);
    }

    return {
      ok: errors.length === 0,
      codocCount: codocMap.size,
      edgeCount: dag.edges.length,
      errors,
      dag,
    };
  }

  // -----------------------------------------------------------------------
  // CRUD impls — all parametric on Repos
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
    return buildImpl(repos, workspaceId);
  }

  async function updateCodocImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<BuildDiagnostics> {
    parseCodoc(newContent);
    await repos.codocRepo.upsert(workspaceId, path, { content: newContent });
    return buildImpl(repos, workspaceId);
  }

  async function deleteCodocImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
  ): Promise<BuildDiagnostics> {
    await repos.codocRepo.delete(workspaceId, path);
    return buildImpl(repos, workspaceId);
  }

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
      chatRepo: repos.chatRepo,
      buildWorkspace: (wid) => buildImpl(repos, wid),
      ...(agentIds ? { agentIds } : {}),
    });
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

  async function resolveNodeImpl(
    repos: Repos,
    workspaceId: string,
    nodeId: string,
    dag: DAG,
  ): Promise<unknown> {
    const { codocRepo, resolvedFieldRepo } = repos;
    const sorted = topoSort(dag);

    // Collect all upstream dependencies of nodeId (including itself)
    const needed = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (needed.has(cur)) continue;
      needed.add(cur);
      for (const dep of dag.dependencies.get(cur) ?? []) {
        queue.push(dep);
      }
    }

    // Cache path → codocId lookups so we don't re-fetch per field.
    const pathToCodocId = new Map<string, string>();
    async function getCodocId(codocPath: string): Promise<string | undefined> {
      let id = pathToCodocId.get(codocPath);
      if (id) return id;
      const row = await codocRepo.findByPath(workspaceId, codocPath);
      if (!row) return undefined;
      id = row.id;
      pathToCodocId.set(codocPath, id);
      return id;
    }

    const resolved = new Map<string, unknown>();
    for (const id of sorted) {
      if (!needed.has(id)) continue;

      const node = dag.nodes.get(id);
      if (!node) continue;

      const field = node.field;
      let value: unknown;

      switch (field.kind) {
        case "static":
          value = field.value;
          break;

        case "ref": {
          const deps = dag.dependencies.get(id);
          if (deps && deps.size > 0) {
            const depId = [...deps][0]!;
            value = resolved.get(depId);
          }
          break;
        }

        case "source": {
          if (isClientSource(field.source)) {
            value = null; // client-side source — resolved in the browser
            break;
          }
          value = await executeSource(field.source, field.params);
          break;
        }
      }

      resolved.set(id, value);

      // Persist this single field. Sibling fields are untouched — no
      // read-merge-write glue required.
      const codocId = await getCodocId(node.codocPath);
      if (codocId) {
        await resolvedFieldRepo.upsertField(
          workspaceId,
          codocId,
          id,
          value,
          "ready",
        );
      }
    }

    return resolved.get(nodeId);
  }

  // -----------------------------------------------------------------------
  // Read-only public methods — use defaultRepos directly (no tx)
  // -----------------------------------------------------------------------

  function listPresets(): WorkspacePresetSummary[] {
    return listWorkspacePresets();
  }

  async function getStatus(workspaceId: string): Promise<WorkspaceStatus> {
    const [all, fields] = await Promise.all([
      defaultRepos.codocRepo.listByWorkspace(workspaceId),
      defaultRepos.resolvedFieldRepo.listByWorkspace(workspaceId),
    ]);
    const byCodoc = groupFieldsByCodoc(fields);
    const states: Record<string, number> = {};
    for (const c of all) {
      const state = deriveCodocState(byCodoc.get(c.id) ?? []);
      states[state] = (states[state] ?? 0) + 1;
    }
    return { codocCount: all.length, states };
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

  async function listWorkspaces(): Promise<WorkspaceListItem[]> {
    return defaultRepos.workspaceRepo.listWithStats();
  }

  async function getWorkspace(id: string): Promise<Workspace | undefined> {
    return defaultRepos.workspaceRepo.findById(id);
  }

  async function deleteWorkspace(id: string): Promise<void> {
    // FK cascades handle codocs / edges / threads / agents — a single
    // DELETE is sufficient.
    await defaultRepos.workspaceRepo.delete(id);
  }

  async function getGraph(workspaceId: string): Promise<WorkspaceGraph> {
    const [codocRows, edgeRows, fields] = await Promise.all([
      defaultRepos.codocRepo.listByWorkspace(workspaceId),
      defaultRepos.edgeRepo.listByWorkspace(workspaceId),
      defaultRepos.resolvedFieldRepo.listByWorkspace(workspaceId),
    ]);
    const byCodoc = groupFieldsByCodoc(fields);
    return {
      nodes: codocRows.map((r) => ({
        path: r.path,
        nodeState: deriveCodocState(byCodoc.get(r.id) ?? []),
      })),
      edges: edgeRows.map((e) => ({ from: e.fromNodeId, to: e.toNodeId })),
    };
  }

  async function getCodocEntry(
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

  // -----------------------------------------------------------------------
  // Public write wrappers — all go through withTx
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

  async function updateWorkspace(
    id: string,
    data: { name?: string; description?: string | null },
  ): Promise<Workspace> {
    return defaultRepos.workspaceRepo.update(id, data);
  }

  async function build(workspaceId: string): Promise<BuildDiagnostics> {
    const result = await withTx((repos) => buildImpl(repos, workspaceId));
    dagCache.set(workspaceId, result.dag);
    return result;
  }

  async function createCodocEntry(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<void> {
    const result = await withTx((repos) =>
      createCodocImpl(repos, workspaceId, path, content),
    );
    dagCache.set(workspaceId, result.dag);
  }

  async function updateCodocEntry(
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<void> {
    const result = await withTx((repos) =>
      updateCodocImpl(repos, workspaceId, path, newContent),
    );
    dagCache.set(workspaceId, result.dag);
  }

  async function deleteCodocEntry(workspaceId: string, path: string): Promise<void> {
    const result = await withTx((repos) =>
      deleteCodocImpl(repos, workspaceId, path),
    );
    dagCache.set(workspaceId, result.dag);
  }

  async function applyPreset(
    workspaceId: string,
    presetId: string,
    agentIds?: string[],
  ): Promise<void> {
    const result = await withTx((repos) =>
      applyPresetImpl(repos, workspaceId, presetId, agentIds),
    );
    dagCache.set(workspaceId, result.dag);
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

    return withTx(async (repos) => {
      const workspace = await repos.workspaceRepo.create({
        name: name?.trim() || preset.defaultWorkspaceName,
        description: preset.workspaceDescription,
      });
      const result = await applyPresetImpl(repos, workspace.id, presetId, agentIds);
      dagCache.set(workspace.id, result.dag);
      return workspace;
    });
  }

  async function patchCodocDataEntry(
    workspaceId: string,
    path: string,
    dataPath: string,
    value: unknown,
  ): Promise<void> {
    const result = await withTx((repos) =>
      patchCodocDataImpl(repos, workspaceId, path, dataPath, value),
    );
    dagCache.set(workspaceId, result.dag);
  }

  async function resolveNode(workspaceId: string, nodeId: string): Promise<unknown> {
    let dag = dagCache.get(workspaceId);
    if (!dag) {
      const diag = await build(workspaceId);
      dag = diag.dag;
    }
    const snapshot = dag;
    return withTx((repos) =>
      resolveNodeImpl(repos, workspaceId, nodeId, snapshot),
    );
  }

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    createWorkspace,
    listWorkspaces,
    getWorkspace,
    deleteWorkspace,
    applyPreset,
    createWorkspaceFromPreset,
    listPresets,
    updateWorkspace,
    getStatus,
    listCodocs,
    build,
    resolve: resolveNode,
    getGraph,
    createCodoc: createCodocEntry,
    updateCodoc: updateCodocEntry,
    deleteCodoc: deleteCodocEntry,
    getCodoc: getCodocEntry,
    getCodocById: (id: string) => defaultRepos.codocRepo.findById(id),
    patchCodocData: patchCodocDataEntry,
    agentSessionRepo,
  };
}

// ---------------------------------------------------------------------------
// Helpers — content-as-truth: every read re-parses from `content`, and parse
// errors degrade gracefully so corrupted rows don't crash the read path.
// ---------------------------------------------------------------------------

function parseCodocAstSafe(content: string): CodocAST | null {
  try {
    return parseCodoc(content);
  } catch {
    return null;
  }
}

function parseCodocMetaSafe(content: string): CodocAST["meta"] | undefined {
  return parseCodocAstSafe(content)?.meta;
}
