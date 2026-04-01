import type { NodeKind, NodeKey } from "../ids/node-id.js";
import type { ParsedCodoc } from "../parser/types.js";
import type { ResolveOptions } from "../runtime/types.js";
import type { FileSourceSpec, HttpSourceSpec } from "../source-spec/types.js";

export interface DagNode {
  id: NodeKey;
  kind: NodeKind;
  codocId: string;
  deps: NodeKey[];
}

export interface GraphEdge {
  from: NodeKey;
  to: NodeKey;
}

export interface GraphSnapshot {
  nodes: DagNode[];
  edges: GraphEdge[];
}

export interface BuildError {
  code: "cycle" | "dangling_ref" | "schema" | "parse";
  message: string;
  node?: NodeKey;
  codocId?: string;
}

export interface BuildResult {
  success: boolean;
  errors: BuildError[];
  affectedNodes: NodeKey[];
}

export interface InvalidationResult {
  dirtiedNodes: NodeKey[];
}

export interface ResolvedValue {
  node: NodeKey;
  value: unknown;
  version: number;
}

export interface SourceLoadContext {
  node: NodeKey;
  codocId: string;
  codocFilePath: string;
}

export interface DagEngineOptions {
  loadSource?: (
    spec: FileSourceSpec | HttpSourceSpec,
    context: SourceLoadContext
  ) => Promise<unknown>;
}

export interface DagEngine {
  build(codocs: ParsedCodoc[]): BuildResult;
  rebuildCodoc(codoc: ParsedCodoc): BuildResult;
  getNode(node: NodeKey): DagNode | null;
  getDeps(node: NodeKey): NodeKey[];
  getDependents(node: NodeKey): NodeKey[];
  resolve(node: NodeKey, opts?: ResolveOptions): Promise<ResolvedValue>;
  invalidate(node: NodeKey): InvalidationResult;
  snapshot(): GraphSnapshot;
}
