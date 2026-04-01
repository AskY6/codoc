import type {
  BuildResult,
  GraphSnapshot,
  ParsedCodoc,
  ResolveOptions,
  ResolvedValue
} from "@cobook/core";
import type { CodocSummary, WorkspaceSnapshot } from "@cobook/workspace";

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
}

export interface CobookService {
  openWorkspace(root: string): Promise<WorkspaceSnapshot>;
  getWorkspace(): Promise<WorkspaceSnapshot>;
  build(): Promise<BuildResult>;
  rebuildCodoc(codocId: string): Promise<BuildResult>;
  listCodocs(): Promise<CodocSummary[]>;
  readCodoc(codocId: string): Promise<ParsedCodoc>;
  writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult>;
  resolve(node: string, opts?: ResolveOptions): Promise<ResolvedValue>;
  graph(): Promise<GraphSnapshot>;
  chat(input: ChatInput): AsyncIterable<ChatEvent>;
}

export type { ChatEvent, ChatInput, CodocSummary, WorkspaceSnapshot };
