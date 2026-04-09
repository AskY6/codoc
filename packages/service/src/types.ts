import type { CodocAST, DAG } from "@cobook/core";

// ---------------------------------------------------------------------------
// Build diagnostics
// ---------------------------------------------------------------------------

export interface DiagnosticError {
  kind: "cycle" | "broken-ref" | "parse-error" | "schema-error";
  message: string;
  path?: string;
  nodes?: string[];
}

export interface BuildDiagnostics {
  ok: boolean;
  codocCount: number;
  edgeCount: number;
  errors: DiagnosticError[];
  dag: DAG;
}

// ---------------------------------------------------------------------------
// Workspace status
// ---------------------------------------------------------------------------

export interface WorkspaceStatus {
  codocCount: number;
  states: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Codoc info (returned by getCodoc)
// ---------------------------------------------------------------------------

export interface CodocInfo {
  path: string;
  content: string;
  ast: CodocAST | null;
  resolvedData: Record<string, unknown> | null;
  nodeState: string;
}

// ---------------------------------------------------------------------------
// Codoc list item (returned by listCodocs — lightweight, no resolvedData)
// ---------------------------------------------------------------------------

export interface CodocListItem {
  id: string;
  path: string;
  nodeState: string;
  meta: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

// ---------------------------------------------------------------------------
// Workspace presets
// ---------------------------------------------------------------------------

export interface WorkspacePresetSummary {
  id: string;
  name: string;
  description: string;
  defaultWorkspaceName: string;
  tags: string[];
  highlights: string[];
  agentOptions: WorkspacePresetAgentOption[];
  featured?: boolean;
}

export interface WorkspacePresetAgentOption {
  id: string;
  selectedByDefault?: boolean;
}

export interface WorkspacePresetDefinition extends WorkspacePresetSummary {
  workspaceDescription: string;
  codocs: Array<{
    path: string;
    content: string;
  }>;
}

// ---------------------------------------------------------------------------
// Source execution
// ---------------------------------------------------------------------------

export class SourceError extends Error {
  override name = "SourceError";
  constructor(
    message: string,
    public readonly sourcePath?: string,
  ) {
    super(message);
  }
}
