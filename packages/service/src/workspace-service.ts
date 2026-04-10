import {
  parseCodoc,
  stringifyYaml,
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
}

function buildRepos(exec: DbExecutor): Repos {
  return {
    workspaceRepo: createWorkspaceRepository(exec),
    codocRepo: createCodocRepository(exec),
    edgeRepo: createEdgeRepository(exec),
    chatRepo: createChatRepository(exec),
  };
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
    const { codocRepo, edgeRepo } = repos;
    const rows = await codocRepo.listByWorkspace(workspaceId);
    const errors: DiagnosticError[] = [];
    const codocMap = new Map<string, CodocAST>();

    // 1. Parse all codocs
    for (const row of rows) {
      if (row.ast) {
        codocMap.set(row.path, row.ast as CodocAST);
        continue;
      }
      try {
        const ast = parseCodoc(row.content);
        codocMap.set(row.path, ast);
        await codocRepo.upsert(workspaceId, row.path, { ast });
      } catch (err) {
        const msg = err instanceof ParseError ? err.message : String(err);
        errors.push({ kind: "parse-error", message: msg, path: row.path });
        await codocRepo.upsert(workspaceId, row.path, { nodeState: "error" });
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

    // 5. Persist edges
    const edgeData = dag.edges.map((e) => ({ fromNodeId: e.from, toNodeId: e.to }));
    await edgeRepo.replaceAll(workspaceId, edgeData);

    // 6. Update node states + resolve static fields eagerly
    const cycleNodes = new Set(cycles.flat());
    const brokenRefNodes = new Set(refResult.errors.map((e) => e.from));

    const codocUpdates = new Map<string, { state: string; resolved: Record<string, unknown> }>();
    for (const [nodeId, node] of dag.nodes) {
      let entry = codocUpdates.get(node.codocPath);
      if (!entry) {
        entry = { state: "ready", resolved: {} };
        codocUpdates.set(node.codocPath, entry);
      }
      if (cycleNodes.has(nodeId) || brokenRefNodes.has(nodeId)) {
        entry.state = "error";
      }
      if (node.field.kind === "static") {
        entry.resolved[nodeId] = node.field.value;
      }
    }

    for (const [codocPath, update] of codocUpdates) {
      // Merge with existing resolved data to preserve previously resolved refs/sources,
      // but drop stale keys that no longer exist in the current DAG.
      const existing = await codocRepo.findByPath(workspaceId, codocPath);
      const prev = (existing?.resolvedValue as Record<string, unknown>) ?? {};
      const validKeys = new Set(
        [...dag.nodes.entries()]
          .filter(([, n]) => n.codocPath === codocPath)
          .map(([k]) => k),
      );
      const merged = { ...prev, ...update.resolved };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(merged)) {
        if (validKeys.has(k)) cleaned[k] = v;
      }
      await codocRepo.upsert(workspaceId, codocPath, {
        nodeState: update.state,
        resolvedValue: cleaned,
      });
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
    const ast = parseCodoc(content);
    await repos.codocRepo.upsert(workspaceId, path, {
      content,
      ast,
      nodeState: "idle",
    });
    return buildImpl(repos, workspaceId);
  }

  async function updateCodocImpl(
    repos: Repos,
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<BuildDiagnostics> {
    const ast = parseCodoc(newContent);
    await repos.codocRepo.upsert(workspaceId, path, {
      content: newContent,
      ast,
      nodeState: "dirty",
    });
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

    const parsed = parseCodoc(row.content);

    const rawData: Record<string, unknown> = {};
    if (parsed.data) {
      for (const [k, field] of Object.entries(parsed.data)) {
        switch (field.kind) {
          case "static":
            rawData[k] = field.value;
            break;
          case "ref":
            rawData[k] = { $ref: field.$ref };
            break;
          case "source": {
            rawData[k] = { $source: field.source, ...field.params };
            break;
          }
        }
      }
    }

    setNestedValue(rawData, dataPath, value);

    const body =
      parsed.view &&
      typeof parsed.view === "object" &&
      "source" in parsed.view &&
      typeof parsed.view.source === "string"
        ? parsed.view.source
        : undefined;

    const newContent = stringifyCodocDocument({
      ...(parsed.meta ? { meta: parsed.meta } : {}),
      data: rawData,
      ...(body ? { body } : {}),
    });

    return updateCodocImpl(repos, workspaceId, path, newContent);
  }

  async function resolveNodeImpl(
    repos: Repos,
    workspaceId: string,
    nodeId: string,
    dag: DAG,
  ): Promise<unknown> {
    const { codocRepo } = repos;
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

      // Persist resolved value — merge with existing to avoid wiping sibling fields,
      // but drop stale keys that no longer exist in the current DAG.
      const existing = await codocRepo.findByPath(workspaceId, node.codocPath);
      const prev = (existing?.resolvedValue as Record<string, unknown>) ?? {};
      const current = Object.fromEntries(
        [...resolved.entries()].filter(([k]) => dag.nodes.get(k)?.codocPath === node.codocPath),
      );
      const validKeys = new Set(
        [...dag.nodes.entries()]
          .filter(([, n]) => n.codocPath === node.codocPath)
          .map(([k]) => k),
      );
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries({ ...prev, ...current })) {
        if (validKeys.has(k)) cleaned[k] = v;
      }
      await codocRepo.upsert(workspaceId, node.codocPath, {
        resolvedValue: cleaned,
        nodeState: "ready",
      });
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
    const all = await defaultRepos.codocRepo.listByWorkspace(workspaceId);
    const states: Record<string, number> = {};
    for (const c of all) {
      states[c.nodeState] = (states[c.nodeState] ?? 0) + 1;
    }
    return { codocCount: all.length, states };
  }

  async function listCodocs(workspaceId: string): Promise<CodocListItem[]> {
    const all = await defaultRepos.codocRepo.listByWorkspace(workspaceId);
    return all.map((c) => {
      const ast = c.ast as CodocAST | null;
      const meta = ast?.meta as Record<string, unknown> | undefined;
      const item: CodocListItem = { id: c.id, path: c.path, nodeState: c.nodeState, meta: {} };
      if (typeof meta?.["title"] === "string") item.meta.title = meta["title"];
      if (typeof meta?.["description"] === "string") item.meta.description = meta["description"];
      if (Array.isArray(meta?.["tags"])) item.meta.tags = meta["tags"] as string[];
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
    const [codocRows, edgeRows] = await Promise.all([
      defaultRepos.codocRepo.listByWorkspace(workspaceId),
      defaultRepos.edgeRepo.listByWorkspace(workspaceId),
    ]);
    return {
      nodes: codocRows.map((r) => ({ path: r.path, nodeState: r.nodeState })),
      edges: edgeRows.map((e) => ({ from: e.fromNodeId, to: e.toNodeId })),
    };
  }

  async function getCodocEntry(
    workspaceId: string,
    path: string,
  ): Promise<CodocInfo | undefined> {
    const row = await defaultRepos.codocRepo.findByPath(workspaceId, path);
    if (!row) return undefined;

    return {
      path: row.path,
      content: row.content,
      ast: (row.ast as CodocAST) ?? null,
      resolvedData: (row.resolvedValue as Record<string, unknown>) ?? null,
      nodeState: row.nodeState,
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set a value at a nested path like "articles[2].readAt".
 * Supports dot notation and bracket indexing.
 */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments: (string | number)[] = [];
  for (const part of path.split(".")) {
    const match = /^(\w+)\[(\d+)\]$/.exec(part);
    if (match) {
      segments.push(match[1]!, Number(match[2]!));
    } else {
      segments.push(part);
    }
  }

  if (segments.some((s) => typeof s === "string" && FORBIDDEN_SEGMENTS.has(s))) {
    throw new Error(`Forbidden path segment in "${path}"`);
  }

  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot traverse path "${path}": missing parent at segment "${seg}"`);
    }
    current = (current as Record<string | number, unknown>)[seg];
  }

  const last = segments[segments.length - 1]!;
  if (current == null || typeof current !== "object") {
    throw new Error(`Cannot set value at path "${path}": parent is not an object`);
  }
  (current as Record<string | number, unknown>)[last] = value;
}

function stringifyCodocDocument(doc: {
  meta?: CodocAST["meta"];
  data?: Record<string, unknown>;
  body?: string;
}): string {
  const frontmatter: Record<string, unknown> = {};
  if (doc.meta) frontmatter["meta"] = doc.meta;
  if (doc.data) frontmatter["data"] = doc.data;

  const yaml = stringifyYaml(frontmatter).trim();
  const body = doc.body?.trim();

  if (!body) {
    return `---\n${yaml}\n---\n`;
  }

  return `---\n${yaml}\n---\n\n${body}\n`;
}
