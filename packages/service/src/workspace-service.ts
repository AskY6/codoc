import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseCodoc,
  buildDAG,
  topoSort,
  detectCycles,
  validateRefs,
  invalidate,
  type CodocAST,
  type DAG,
  ParseError,
} from "@cobook/core";
import type {
  WorkspaceRepository,
  CodocRepository,
  EdgeRepository,
  Workspace,
} from "./db/repositories/types.js";
import { executeSource, type Source } from "./source-executor.js";
import type {
  BuildDiagnostics,
  CodocInfo,
  DiagnosticError,
  WorkspaceStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface WorkspaceServiceDeps {
  workspaceRepo: WorkspaceRepository;
  codocRepo: CodocRepository;
  edgeRepo: EdgeRepository;
}

export interface WorkspaceService {
  openWorkspace(dir: string): Promise<Workspace>;
  getStatus(workspaceId: string): Promise<WorkspaceStatus>;
  build(workspaceId: string): Promise<BuildDiagnostics>;
  resolve(workspaceId: string, nodeId: string): Promise<unknown>;
  createCodoc(workspaceId: string, path: string, content: string): Promise<void>;
  updateCodoc(workspaceId: string, path: string, newContent: string): Promise<void>;
  deleteCodoc(workspaceId: string, path: string): Promise<void>;
  getCodoc(workspaceId: string, path: string): Promise<CodocInfo | undefined>;
}

export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService {
  const { workspaceRepo, codocRepo, edgeRepo } = deps;

  // In-memory DAG cache keyed by workspaceId — rebuilt on build()
  const dagCache = new Map<string, DAG>();

  // -----------------------------------------------------------------------
  // openWorkspace (3-1)
  // -----------------------------------------------------------------------

  async function openWorkspace(dir: string): Promise<Workspace> {
    const absDir = resolve(dir);

    // Read workspace name from cobook.yaml if present
    let name = "untitled";
    try {
      const raw = await readFile(resolve(absDir, "cobook.yaml"), "utf-8");
      const cfg = parseYaml(raw);
      if (cfg && typeof cfg === "object" && "name" in cfg && typeof cfg.name === "string") {
        name = cfg.name;
      }
    } catch {
      // cobook.yaml missing or unparseable — use default name
    }

    // Upsert workspace record
    let ws = await workspaceRepo.findByPath(absDir);
    if (!ws) {
      ws = await workspaceRepo.create({ name, rootPath: absDir });
    }

    // Scan for .codoc files
    const codocPaths = await scanCodocFiles(absDir);

    for (const relPath of codocPaths) {
      const absPath = resolve(absDir, relPath);
      const content = await readFile(absPath, "utf-8");
      let ast: CodocAST | null = null;
      try {
        ast = parseCodoc(content);
      } catch {
        // Store content even if parse fails; build will report the error
      }
      await codocRepo.upsert(ws.id, relPath, {
        content,
        ast: ast ?? undefined,
        nodeState: "idle",
      });
    }

    return ws;
  }

  // -----------------------------------------------------------------------
  // getStatus (3-1)
  // -----------------------------------------------------------------------

  async function getStatus(workspaceId: string): Promise<WorkspaceStatus> {
    const all = await codocRepo.listByWorkspace(workspaceId);
    const states: Record<string, number> = {};
    for (const c of all) {
      states[c.nodeState] = (states[c.nodeState] ?? 0) + 1;
    }
    return { codocCount: all.length, states };
  }

  // -----------------------------------------------------------------------
  // build (3-2)
  // -----------------------------------------------------------------------

  async function build(workspaceId: string): Promise<BuildDiagnostics> {
    const rows = await codocRepo.listByWorkspace(workspaceId);
    const errors: DiagnosticError[] = [];
    const codocMap = new Map<string, CodocAST>();

    // 1. Parse all codocs
    for (const row of rows) {
      if (row.ast) {
        codocMap.set(row.path, row.ast as CodocAST);
        continue;
      }
      // Re-parse if ast is missing
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
    dagCache.set(workspaceId, dag);

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

    // 6. Update node states
    const cycleNodes = new Set(cycles.flat());
    const brokenRefNodes = new Set(refResult.errors.map((e) => e.from));

    for (const [nodeId, node] of dag.nodes) {
      let state = "ready";
      if (cycleNodes.has(nodeId)) state = "error";
      if (brokenRefNodes.has(nodeId)) state = "error";

      await codocRepo.upsert(workspaceId, node.codocPath, { nodeState: state });
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
  // resolve (3-3)
  // -----------------------------------------------------------------------

  async function resolveNode(workspaceId: string, nodeId: string): Promise<unknown> {
    const ws = await workspaceRepo.findById(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    let dag = dagCache.get(workspaceId);
    if (!dag) {
      const result = await build(workspaceId);
      dag = result.dag;
    }

    // Get topo-sorted order, filter to only nodes in the subgraph leading to nodeId
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

    // Resolve in topo order
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
          // The referenced node should already be resolved (topo order)
          const deps = dag.dependencies.get(id);
          if (deps && deps.size > 0) {
            const depId = [...deps][0]!;
            value = resolved.get(depId);
          }
          break;
        }

        case "source": {
          const source = toSource(field);
          value = await executeSource(source, ws.rootPath);
          break;
        }
      }

      resolved.set(id, value);

      // Persist resolved value
      await codocRepo.upsert(workspaceId, node.codocPath, {
        resolvedValue: Object.fromEntries(
          [...resolved.entries()].filter(([k]) => dag!.nodes.get(k)?.codocPath === node.codocPath),
        ),
        nodeState: "ready",
      });
    }

    return resolved.get(nodeId);
  }

  // -----------------------------------------------------------------------
  // CRUD (3-5)
  // -----------------------------------------------------------------------

  async function createCodocEntry(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<void> {
    const ws = await workspaceRepo.findById(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    // Write file to workspace directory
    const absPath = resolve(ws.rootPath, path);
    await writeFile(absPath, content, "utf-8");

    // Parse and persist
    let ast: CodocAST | undefined;
    try {
      ast = parseCodoc(content);
    } catch {
      // Will be flagged during build
    }
    await codocRepo.upsert(workspaceId, path, {
      content,
      ast,
      nodeState: "idle",
    });

    // Trigger rebuild
    await build(workspaceId);
  }

  async function updateCodocEntry(
    workspaceId: string,
    path: string,
    newContent: string,
  ): Promise<void> {
    const ws = await workspaceRepo.findById(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    // Write file
    const absPath = resolve(ws.rootPath, path);
    await writeFile(absPath, newContent, "utf-8");

    // Parse and persist
    let ast: CodocAST | undefined;
    try {
      ast = parseCodoc(newContent);
    } catch {
      // Will be flagged during build
    }
    await codocRepo.upsert(workspaceId, path, {
      content: newContent,
      ast,
      nodeState: "dirty",
    });

    // Rebuild to propagate changes
    await build(workspaceId);
  }

  async function deleteCodocEntry(workspaceId: string, path: string): Promise<void> {
    const ws = await workspaceRepo.findById(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    // Delete file
    const absPath = resolve(ws.rootPath, path);
    try {
      await unlink(absPath);
    } catch {
      // File may already be gone
    }

    // Remove from DB
    await codocRepo.delete(workspaceId, path);

    // Rebuild to update DAG and detect broken refs
    await build(workspaceId);
  }

  async function getCodocEntry(
    workspaceId: string,
    path: string,
  ): Promise<CodocInfo | undefined> {
    const row = await codocRepo.findByPath(workspaceId, path);
    if (!row) return undefined;

    return {
      path: row.path,
      ast: (row.ast as CodocAST) ?? null,
      resolvedData: (row.resolvedValue as Record<string, unknown>) ?? null,
      nodeState: row.nodeState,
    };
  }

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    openWorkspace,
    getStatus,
    build,
    resolve: resolveNode,
    createCodoc: createCodocEntry,
    updateCodoc: updateCodocEntry,
    deleteCodoc: deleteCodocEntry,
    getCodoc: getCodocEntry,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function scanCodocFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const nested = await scanCodocFiles(fullPath);
      results.push(...nested);
    } else if (entry.name.endsWith(".codoc")) {
      results.push(relative(dir, fullPath));
    }
  }

  return results;
}

function toSource(field: { source: string; params: Record<string, unknown> }): Source {
  if (field.source === "file") {
    return { type: "file", path: String(field.params["path"] ?? "") };
  }
  // Default: treat as static with params as value
  return { type: "static", value: field.params };
}
