import type {
  BuildResult,
  GraphSnapshot,
  InvalidationResult,
  NodeState,
  ParsedCodoc,
  ResolveOptions,
  ResolvedValue
} from "@cobook/core";
import type { DagNode } from "@cobook/core";
import type {
  CodocSummary,
  WorkspaceChangeEvent,
  WorkspaceSnapshot
} from "@cobook/workspace";

import type { ChatEvent, ChatInput } from "./ai/index.js";

export interface WriteCodocInput {
  codocId: string;
  filePath: string;
  content: string;
  overwrite?: boolean;
}

export interface WriteCodocResult {
  codocId: string;
  filePath: string;
  changed: boolean;
  build: BuildResult;
}

export interface NodeDiagnostics {
  node: DagNode;
  state: NodeState;
  dependents: string[];
}

export interface WorkspaceDiagnostics {
  build: BuildResult | null;
  graph: GraphSnapshot;
  nodes: NodeDiagnostics[];
}

export interface WorkspaceWatchEvent {
  change: WorkspaceChangeEvent;
  build: BuildResult;
}

export interface CobookService {
  openWorkspace(root: string): Promise<WorkspaceSnapshot>;
  closeWorkspace(): Promise<void>;
  getWorkspace(): Promise<WorkspaceSnapshot>;
  build(): Promise<BuildResult>;
  rebuildCodoc(codocId: string): Promise<BuildResult>;
  listCodocs(): Promise<CodocSummary[]>;
  readCodoc(codocId: string): Promise<ParsedCodoc>;
  writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult>;
  invalidate(node: string): Promise<InvalidationResult>;
  resolve(node: string, opts?: ResolveOptions): Promise<ResolvedValue>;
  graph(): Promise<GraphSnapshot>;
  diagnostics(): Promise<WorkspaceDiagnostics>;
  watch(signal?: AbortSignal): AsyncIterable<WorkspaceWatchEvent>;
  chat(input: ChatInput): AsyncIterable<ChatEvent>;
}

export type {
  BuildResult,
  InvalidationResult,
  NodeState,
  GraphSnapshot,
  ParsedCodoc,
  ResolveOptions,
  ResolvedValue
} from "@cobook/core";
export type { ChatEvent, ChatInput, CodocSummary, WorkspaceChangeEvent, WorkspaceSnapshot };
