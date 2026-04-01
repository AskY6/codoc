import { posix } from "node:path";

import { toNodeKey, type NodeKey } from "../ids/node-id.js";
import type { ParsedCodoc, ViewSpec } from "../parser/types.js";
import type { CodocRef } from "../ref/types.js";
import type { ResolveOptions, NodeState } from "../runtime/types.js";
import type { DataSpec, ObjectShapeSpec } from "../source-spec/types.js";

import type {
  BuildError,
  BuildResult,
  DagEngine,
  DagEngineOptions,
  DagNode,
  GraphEdge,
  GraphSnapshot,
  InvalidationResult,
  ResolvedValue
} from "./types.js";

interface InternalBaseNode extends DagNode {
  codocFilePath: string;
  path: string[];
}

interface InternalDataNode extends InternalBaseNode {
  kind: "data";
  spec: DataSpec;
}

interface InternalViewNode extends InternalBaseNode {
  kind: "view";
  view: ViewSpec;
}

interface InternalCodocNode extends InternalBaseNode {
  kind: "codoc";
  codoc: ParsedCodoc;
}

type InternalNode = InternalDataNode | InternalViewNode | InternalCodocNode;

interface BuildArtifacts {
  nodes: Map<NodeKey, InternalNode>;
  dependents: Map<NodeKey, Set<NodeKey>>;
  snapshot: GraphSnapshot;
  result: BuildResult;
}

const ROOT_PATH: string[] = [];

export function createDagEngine(options: DagEngineOptions = {}): DagEngine {
  return new DefaultDagEngine(options);
}

class DefaultDagEngine implements DagEngine {
  readonly #options: DagEngineOptions;
  #codocs = new Map<string, ParsedCodoc>();
  #nodes = new Map<NodeKey, InternalNode>();
  #dependents = new Map<NodeKey, Set<NodeKey>>();
  #snapshot: GraphSnapshot = {
    nodes: [],
    edges: []
  };
  #states = new Map<NodeKey, NodeState>();
  #lastBuild: BuildResult = {
    success: true,
    errors: [],
    affectedNodes: []
  };

  constructor(options: DagEngineOptions) {
    this.#options = options;
  }

  build(codocs: ParsedCodoc[]): BuildResult {
    const nextCodocs = new Map<string, ParsedCodoc>();

    for (const codoc of codocs) {
      nextCodocs.set(codoc.id, codoc);
    }

    const artifacts = buildArtifacts(Array.from(nextCodocs.values()));
    this.#codocs = nextCodocs;
    this.#nodes = artifacts.nodes;
    this.#dependents = artifacts.dependents;
    this.#snapshot = artifacts.snapshot;
    this.#states = new Map();
    this.#lastBuild = artifacts.result;

    return this.#lastBuild;
  }

  rebuildCodoc(codoc: ParsedCodoc): BuildResult {
    const previousNodes = this.#nodes;
    const previousDependents = this.#dependents;
    const previousStates = this.#states;
    const nextCodocEntries = Array.from(this.#codocs.values()).filter(
      (existing) => existing.id !== codoc.id && existing.filePath !== codoc.filePath
    );
    nextCodocEntries.push(codoc);

    const nextCodocs = new Map<string, ParsedCodoc>();
    for (const entry of nextCodocEntries) {
      nextCodocs.set(entry.id, entry);
    }

    const artifacts = buildArtifacts(Array.from(nextCodocs.values()));
    const affectedNodes = collectAffectedNodes(
      previousNodes,
      previousDependents,
      artifacts.nodes,
      artifacts.dependents
    );

    this.#codocs = nextCodocs;
    this.#nodes = artifacts.nodes;
    this.#dependents = artifacts.dependents;
    this.#snapshot = artifacts.snapshot;
    this.#states = carryForwardStates(
      previousNodes,
      previousStates,
      artifacts.nodes,
      new Set(affectedNodes)
    );
    this.#lastBuild = {
      ...artifacts.result,
      affectedNodes
    };

    return this.#lastBuild;
  }

  getNode(node: NodeKey): DagNode | null {
    return this.#nodes.get(node) ?? null;
  }

  getDeps(node: NodeKey): NodeKey[] {
    return [...(this.#nodes.get(node)?.deps ?? [])];
  }

  getDependents(node: NodeKey): NodeKey[] {
    return sortNodeKeys(Array.from(this.#dependents.get(node) ?? []));
  }

  async resolve(node: NodeKey, opts?: ResolveOptions): Promise<ResolvedValue> {
    if (opts?.force) {
      this.invalidate(node);
    }

    return this.#resolveNode(node, opts, new Set());
  }

  invalidate(node: NodeKey): InvalidationResult {
    if (!this.#nodes.has(node)) {
      return {
        dirtiedNodes: []
      };
    }

    const dirtied = new Set<NodeKey>();
    const queue: NodeKey[] = [node];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || dirtied.has(current)) {
        continue;
      }

      dirtied.add(current);

      const previous = this.#states.get(current);
      this.#states.set(current, {
        status: "dirty",
        version: previous?.version ?? 0,
        value: previous?.value,
        error: previous?.error ?? null
      });

      for (const dependent of this.#dependents.get(current) ?? []) {
        queue.push(dependent);
      }
    }

    return {
      dirtiedNodes: sortNodeKeys(Array.from(dirtied))
    };
  }

  snapshot(): GraphSnapshot {
    return {
      nodes: [...this.#snapshot.nodes],
      edges: [...this.#snapshot.edges]
    };
  }

  async #resolveNode(
    nodeKey: NodeKey,
    opts: ResolveOptions | undefined,
    active: Set<NodeKey>
  ): Promise<ResolvedValue> {
    throwIfAborted(opts?.signal);

    const node = this.#nodes.get(nodeKey);
    if (!node) {
      throw new Error(`Node "${nodeKey}" does not exist in the current graph.`);
    }

    const cached = this.#states.get(nodeKey);
    if (cached?.status === "ready") {
      return {
        node: nodeKey,
        value: cached.value,
        version: cached.version
      };
    }

    if (active.has(nodeKey)) {
      throw new Error(`Cycle detected while resolving "${nodeKey}".`);
    }

    active.add(nodeKey);

    this.#states.set(nodeKey, {
      status: "computing",
      version: cached?.version ?? 0,
      value: cached?.value,
      error: null
    });

    try {
      const value = await this.#computeNode(node, opts, active);
      const nextState: NodeState = {
        status: "ready",
        version: (cached?.version ?? 0) + 1,
        value,
        error: null
      };

      this.#states.set(nodeKey, nextState);

      return {
        node: nodeKey,
        value,
        version: nextState.version
      };
    } catch (error) {
      const nextState: NodeState = {
        status: "error",
        version: (cached?.version ?? 0) + 1,
        value: cached?.value,
        error: error instanceof Error ? error : new Error(String(error))
      };

      this.#states.set(nodeKey, nextState);
      throw nextState.error;
    } finally {
      active.delete(nodeKey);
    }
  }

  async #computeNode(
    node: InternalNode,
    opts: ResolveOptions | undefined,
    active: Set<NodeKey>
  ): Promise<unknown> {
    switch (node.kind) {
      case "data":
        return this.#computeDataNode(node, opts, active);
      case "view":
        return this.#computeViewNode(node, opts);
      case "codoc":
        return this.#computeCodocNode(node, opts, active);
    }
  }

  async #computeDataNode(
    node: InternalDataNode,
    opts: ResolveOptions | undefined,
    active: Set<NodeKey>
  ): Promise<unknown> {
    switch (node.spec.kind) {
      case "static":
        return node.spec.value;
      case "file":
        if (!this.#options.loadFileSource) {
          throw new Error(`No file source loader was configured for "${node.id}".`);
        }

        return this.#options.loadFileSource(node.spec, {
          node: node.id,
          codocId: node.codocId,
          codocFilePath: node.codocFilePath
        });
      case "codoc": {
        const target = node.deps[0];
        if (!target) {
          throw new Error(`Codoc ref node "${node.id}" does not have a valid target.`);
        }

        try {
          const resolved = await this.#resolveNode(target, opts, active);
          return resolved.value;
        } catch (error) {
          if (node.spec.defaultValue !== undefined) {
            return node.spec.defaultValue;
          }

          throw error;
        }
      }
      case "object": {
        const value: Record<string, unknown> = {};

        for (const key of Object.keys(node.spec.fields)) {
          const childNode = toNodeKey({
            codocId: node.codocId,
            section: "data",
            path: [...node.path, key]
          });
          const resolved = await this.#resolveNode(childNode, opts, active);
          value[key] = resolved.value;
        }

        return value;
      }
    }
  }

  async #computeViewNode(
    node: InternalViewNode,
    _opts: ResolveOptions | undefined
  ): Promise<unknown> {
    if (typeof node.view === "string") {
      return node.view;
    }

    if (!this.#options.loadFileSource) {
      throw new Error(`No file source loader was configured for "${node.id}".`);
    }

    return this.#options.loadFileSource(
      {
        kind: "file",
        path: node.view.path,
        format: "text"
      },
      {
        node: node.id,
        codocId: node.codocId,
        codocFilePath: node.codocFilePath
      }
    );
  }

  async #computeCodocNode(
    node: InternalCodocNode,
    opts: ResolveOptions | undefined,
    active: Set<NodeKey>
  ): Promise<unknown> {
    const dataNodeKey = toNodeKey({
      codocId: node.codocId,
      section: "data",
      path: ROOT_PATH
    });
    const viewNodeKey = toNodeKey({
      codocId: node.codocId,
      section: "view",
      path: ROOT_PATH
    });

    const resolvedData = this.#nodes.has(dataNodeKey)
      ? await this.#resolveNode(dataNodeKey, opts, active)
      : null;
    const resolvedView = this.#nodes.has(viewNodeKey)
      ? await this.#resolveNode(viewNodeKey, opts, active)
      : null;

    return {
      codoc: node.codoc.codoc,
      id: node.codoc.id,
      filePath: node.codoc.filePath,
      ...(node.codoc.meta ? { meta: node.codoc.meta } : {}),
      ...(resolvedData ? { data: resolvedData.value } : {}),
      ...(node.codoc.component ? { component: node.codoc.component } : {}),
      ...(resolvedView ? { view: resolvedView.value } : {})
    };
  }
}

function buildArtifacts(codocs: ParsedCodoc[]): BuildArtifacts {
  const codocById = new Map<string, ParsedCodoc>();
  const codocIdByFilePath = new Map<string, string>();

  for (const codoc of codocs) {
    codocById.set(codoc.id, codoc);
    codocIdByFilePath.set(normalizeWorkspacePath(codoc.filePath), codoc.id);
  }

  const nodes = new Map<NodeKey, InternalNode>();
  const errors: BuildError[] = [];

  for (const codoc of codocs) {
    if (codoc.data) {
      addDataNode(
        nodes,
        codoc,
        ROOT_PATH,
        {
          kind: "object",
          fields: codoc.data
        } satisfies ObjectShapeSpec
      );
    }

    if (codoc.view) {
      const viewNodeKey = toNodeKey({
        codocId: codoc.id,
        section: "view",
        path: ROOT_PATH
      });

      nodes.set(viewNodeKey, {
        id: viewNodeKey,
        kind: "view",
        codocId: codoc.id,
        codocFilePath: codoc.filePath,
        path: [],
        deps: codoc.data
          ? [
              toNodeKey({
                codocId: codoc.id,
                section: "data",
                path: ROOT_PATH
              })
            ]
          : [],
        view: codoc.view
      });
    }

    const codocNodeKey = toNodeKey({
      codocId: codoc.id,
      section: "codoc",
      path: ROOT_PATH
    });
    const codocDeps: NodeKey[] = [];

    if (codoc.data) {
      codocDeps.push(
        toNodeKey({
          codocId: codoc.id,
          section: "data",
          path: ROOT_PATH
        })
      );
    }

    if (codoc.view) {
      codocDeps.push(
        toNodeKey({
          codocId: codoc.id,
          section: "view",
          path: ROOT_PATH
        })
      );
    }

    nodes.set(codocNodeKey, {
      id: codocNodeKey,
      kind: "codoc",
      codocId: codoc.id,
      codocFilePath: codoc.filePath,
      path: [],
      deps: codocDeps,
      codoc
    });
  }

  for (const node of nodes.values()) {
    if (node.kind !== "data" || node.spec.kind !== "codoc") {
      continue;
    }

    const targetNodeKey = resolveCodocTargetNode(
      node.spec.ref,
      node,
      codocById,
      codocIdByFilePath,
      nodes
    );

    if (!targetNodeKey) {
      errors.push({
        code: "dangling_ref",
        message: `Ref "${node.spec.ref.raw}" from "${node.id}" does not point to a valid node.`,
        node: node.id,
        codocId: node.codocId
      });
      continue;
    }

    node.deps = [targetNodeKey];
  }

  const dependents = buildDependents(nodes);
  errors.push(...detectCycles(nodes));

  const snapshot = {
    nodes: sortDagNodes(Array.from(nodes.values()).map(toPublicNode)),
    edges: sortGraphEdges(createEdges(nodes))
  } satisfies GraphSnapshot;

  return {
    nodes,
    dependents,
    snapshot,
    result: {
      success: errors.length === 0,
      errors,
      affectedNodes: sortNodeKeys(Array.from(nodes.keys()))
    }
  };
}

function collectAffectedNodes(
  previousNodes: Map<NodeKey, InternalNode>,
  previousDependents: Map<NodeKey, Set<NodeKey>>,
  nextNodes: Map<NodeKey, InternalNode>,
  nextDependents: Map<NodeKey, Set<NodeKey>>
): NodeKey[] {
  if (previousNodes.size === 0) {
    return sortNodeKeys(Array.from(nextNodes.keys()));
  }

  const directChanges = new Set<NodeKey>();
  const allNodeKeys = new Set<NodeKey>([...previousNodes.keys(), ...nextNodes.keys()]);

  for (const nodeKey of allNodeKeys) {
    const previous = previousNodes.get(nodeKey);
    const next = nextNodes.get(nodeKey);

    if (!previous || !next || !nodesEquivalent(previous, next)) {
      directChanges.add(nodeKey);
    }
  }

  if (directChanges.size === 0) {
    return [];
  }

  const affected = new Set<NodeKey>(directChanges);
  const queue = Array.from(directChanges);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const dependent of previousDependents.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }

    for (const dependent of nextDependents.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return sortNodeKeys(Array.from(affected));
}

function carryForwardStates(
  previousNodes: Map<NodeKey, InternalNode>,
  previousStates: Map<NodeKey, NodeState>,
  nextNodes: Map<NodeKey, InternalNode>,
  affectedNodes: Set<NodeKey>
): Map<NodeKey, NodeState> {
  const nextStates = new Map<NodeKey, NodeState>();

  for (const [nodeKey, node] of nextNodes) {
    const previousState = previousStates.get(nodeKey);
    const previousNode = previousNodes.get(nodeKey);

    if (!previousState || !previousNode) {
      continue;
    }

    if (affectedNodes.has(nodeKey)) {
      nextStates.set(nodeKey, {
        status: "dirty",
        version: previousState.version,
        value: previousState.value,
        error: previousState.error
      });
      continue;
    }

    if (nodesEquivalent(previousNode, node)) {
      nextStates.set(nodeKey, previousState);
    }
  }

  return nextStates;
}

function addDataNode(
  nodes: Map<NodeKey, InternalNode>,
  codoc: ParsedCodoc,
  path: string[],
  spec: DataSpec
): void {
  const nodeKey = toNodeKey({
    codocId: codoc.id,
    section: "data",
    path
  });
  const node: InternalDataNode = {
    id: nodeKey,
    kind: "data",
    codocId: codoc.id,
    codocFilePath: codoc.filePath,
    path: [...path],
    deps: [],
    spec
  };

  nodes.set(nodeKey, node);

  if (spec.kind !== "object") {
    return;
  }

  for (const [field, childSpec] of Object.entries(spec.fields)) {
    const childPath = [...path, field];
    addDataNode(nodes, codoc, childPath, childSpec);
    node.deps.push(
      toNodeKey({
        codocId: codoc.id,
        section: "data",
        path: childPath
      })
    );
  }
}

function resolveCodocTargetNode(
  ref: CodocRef,
  sourceNode: InternalDataNode,
  codocById: Map<string, ParsedCodoc>,
  codocIdByFilePath: Map<string, string>,
  nodes: Map<NodeKey, InternalNode>
): NodeKey | null {
  const targetCodocId = resolveTargetCodocId(ref, sourceNode, codocById, codocIdByFilePath);
  if (!targetCodocId) {
    return null;
  }

  const pointerSegments = splitPointer(ref.pointer);
  if (pointerSegments.length === 0) {
    const nodeKey = toNodeKey({
      codocId: targetCodocId,
      section: "codoc",
      path: ROOT_PATH
    });
    return nodes.has(nodeKey) ? nodeKey : null;
  }

  const [section, ...path] = pointerSegments;
  if (section === "data") {
    const nodeKey = toNodeKey({
      codocId: targetCodocId,
      section: "data",
      path
    });
    return nodes.has(nodeKey) ? nodeKey : null;
  }

  if (section === "view" && path.length === 0) {
    const nodeKey = toNodeKey({
      codocId: targetCodocId,
      section: "view",
      path: ROOT_PATH
    });
    return nodes.has(nodeKey) ? nodeKey : null;
  }

  if (section === "codoc" && path.length === 0) {
    const nodeKey = toNodeKey({
      codocId: targetCodocId,
      section: "codoc",
      path: ROOT_PATH
    });
    return nodes.has(nodeKey) ? nodeKey : null;
  }

  return null;
}

function resolveTargetCodocId(
  ref: CodocRef,
  sourceNode: InternalDataNode,
  codocById: Map<string, ParsedCodoc>,
  codocIdByFilePath: Map<string, string>
): string | null {
  if (ref.codocPath === null) {
    return sourceNode.codocId;
  }

  const normalizedPath = normalizeReferencePath(sourceNode.codocFilePath, ref.codocPath);
  const byFilePath = codocIdByFilePath.get(normalizedPath);
  if (byFilePath) {
    return byFilePath;
  }

  return codocById.has(ref.codocPath) ? ref.codocPath : null;
}

function normalizeReferencePath(sourceFilePath: string, targetPath: string): string {
  if (targetPath.startsWith("/")) {
    return normalizeWorkspacePath(targetPath.slice(1));
  }

  return normalizeWorkspacePath(posix.join(posix.dirname(sourceFilePath), targetPath));
}

function normalizeWorkspacePath(path: string): string {
  return posix.normalize(path).replace(/^\.\/+/, "");
}

function splitPointer(pointer: string): string[] {
  if (pointer === "/") {
    return [];
  }

  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function buildDependents(nodes: Map<NodeKey, InternalNode>): Map<NodeKey, Set<NodeKey>> {
  const dependents = new Map<NodeKey, Set<NodeKey>>();

  for (const node of nodes.values()) {
    for (const dependency of node.deps) {
      const entries = dependents.get(dependency) ?? new Set<NodeKey>();
      entries.add(node.id);
      dependents.set(dependency, entries);
    }
  }

  return dependents;
}

function detectCycles(nodes: Map<NodeKey, InternalNode>): BuildError[] {
  const visiting = new Set<NodeKey>();
  const visited = new Set<NodeKey>();
  const stack: NodeKey[] = [];
  const cycleSignatures = new Set<string>();
  const errors: BuildError[] = [];

  for (const nodeKey of sortNodeKeys(Array.from(nodes.keys()))) {
    visit(nodeKey);
  }

  return errors;

  function visit(nodeKey: NodeKey): void {
    if (visited.has(nodeKey)) {
      return;
    }

    if (visiting.has(nodeKey)) {
      const startIndex = stack.indexOf(nodeKey);
      const cycle = startIndex === -1 ? [nodeKey] : stack.slice(startIndex).concat(nodeKey);
      const signature = [...new Set(cycle)].sort().join("->");

      if (!cycleSignatures.has(signature)) {
        cycleSignatures.add(signature);
        const cycleCodocId = nodes.get(nodeKey)?.codocId;
        errors.push({
          code: "cycle",
          message: `Cycle detected: ${cycle.join(" -> ")}`,
          node: nodeKey,
          ...(cycleCodocId ? { codocId: cycleCodocId } : {})
        });
      }

      return;
    }

    const node = nodes.get(nodeKey);
    if (!node) {
      return;
    }

    visiting.add(nodeKey);
    stack.push(nodeKey);

    for (const dependency of node.deps) {
      visit(dependency);
    }

    stack.pop();
    visiting.delete(nodeKey);
    visited.add(nodeKey);
  }
}

function createEdges(nodes: Map<NodeKey, InternalNode>): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const node of nodes.values()) {
    for (const dependency of node.deps) {
      edges.push({
        from: node.id,
        to: dependency
      });
    }
  }

  return edges;
}

function toPublicNode(node: InternalNode): DagNode {
  return {
    id: node.id,
    kind: node.kind,
    codocId: node.codocId,
    deps: [...node.deps]
  };
}

function nodesEquivalent(left: InternalNode, right: InternalNode): boolean {
  if (
    left.id !== right.id ||
    left.kind !== right.kind ||
    left.codocId !== right.codocId ||
    left.codocFilePath !== right.codocFilePath ||
    !sameStringArray(left.deps, right.deps)
  ) {
    return false;
  }

  return serializeComparableNode(left) === serializeComparableNode(right);
}

function serializeComparableNode(node: InternalNode): string {
  switch (node.kind) {
    case "data":
      return JSON.stringify(node.spec);
    case "view":
      return JSON.stringify(node.view);
    case "codoc":
      return JSON.stringify({
        codoc: node.codoc.codoc,
        id: node.codoc.id,
        filePath: node.codoc.filePath,
        meta: node.codoc.meta,
        component: node.codoc.component,
        view: node.codoc.view
      });
  }
}

function sortNodeKeys(nodeKeys: NodeKey[]): NodeKey[] {
  return [...nodeKeys].sort((left, right) => left.localeCompare(right));
}

function sortDagNodes(nodes: DagNode[]): DagNode[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function sortGraphEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort((left, right) => {
    if (left.from === right.from) {
      return left.to.localeCompare(right.to);
    }

    return left.from.localeCompare(right.from);
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("The operation was aborted.");
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
