import {
  parseCodoc,
  buildDAG,
  topoSort,
  detectCycles,
  validateRefs,
  isClientSource,
  type CodocAST,
  type DAG,
  ParseError,
} from "@cobook/core";
import type { ResolvedFieldState } from "@cobook/storage";
import { executeSource } from "./source-executor.js";
import type { Repos } from "./internal/repos.js";
import {
  deriveCodocState,
  groupFieldsByCodoc,
  parseErrorNodeId,
} from "./internal/field-helpers.js";
import type {
  BuildDiagnostics,
  DiagnosticError,
  WorkspaceGraph,
  WorkspaceStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// BuildService
//
// Owns the DAG cache and the build/resolve pipeline. Other sub-services
// compose `buildImpl` within their own write transactions and call
// `invalidate` *after* the tx commits so a rollback cannot leave stale DAG
// state in the cache.
// ---------------------------------------------------------------------------

export interface BuildService {
  // Public API — exposed on the facade.
  build(workspaceId: string): Promise<BuildDiagnostics>;
  resolve(workspaceId: string, nodeId: string): Promise<unknown>;
  getStatus(workspaceId: string): Promise<WorkspaceStatus>;
  getGraph(workspaceId: string): Promise<WorkspaceGraph>;

  // Tx-composable — for use by other sub-services inside their `withTx`.
  // The caller is responsible for calling `invalidate` with the returned
  // DAG after the surrounding transaction has committed.
  buildImpl(repos: Repos, workspaceId: string): Promise<BuildDiagnostics>;
  invalidate(workspaceId: string, dag: DAG): void;
}

export interface BuildServiceDeps {
  defaultRepos: Repos;
  withTx: <T>(fn: (repos: Repos) => Promise<T>) => Promise<T>;
}

export function createBuildService(deps: BuildServiceDeps): BuildService {
  const { defaultRepos, withTx } = deps;

  // In-memory DAG cache keyed by workspaceId — rebuilt on build(). Only
  // updated by `invalidate` callers *after* the surrounding transaction
  // commits, so a rollback cannot leave stale DAG state in the cache.
  const dagCache = new Map<string, DAG>();

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
    const edgeData = dag.edges.map((e) => ({
      fromNodeId: e.from,
      toNodeId: e.to,
    }));
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
  // Public API
  // -----------------------------------------------------------------------

  async function build(workspaceId: string): Promise<BuildDiagnostics> {
    const result = await withTx((repos) => buildImpl(repos, workspaceId));
    dagCache.set(workspaceId, result.dag);
    return result;
  }

  async function resolve(
    workspaceId: string,
    nodeId: string,
  ): Promise<unknown> {
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

  function invalidate(workspaceId: string, dag: DAG): void {
    dagCache.set(workspaceId, dag);
  }

  return {
    build,
    resolve,
    getStatus,
    getGraph,
    buildImpl,
    invalidate,
  };
}
