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
  ast: CodocAST | null;
  resolvedData: Record<string, unknown> | null;
  nodeState: string;
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
