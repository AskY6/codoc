// --- Field State Machine ---

export type FieldState<T> =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "resolved"; value: T }
  | { status: "error"; error: FieldError }
  | { status: "dirty" };

export type FieldError =
  | { kind: "validation"; message: string; path: string; schema: unknown }
  | { kind: "cyclic_ref"; message: string; path: string; cycle: string[] }
  | { kind: "ref_not_found"; message: string; path: string }
  | { kind: "loader"; message: string; cause?: unknown }
  | { kind: "source"; message: string; url?: string; retryable: boolean; cause?: unknown }
  | { kind: "prompt"; message: string; retryable: boolean; cause?: unknown }
  | { kind: "external_ref"; message: string; docRef: string; fieldPath: string };

// --- Source / Loader Declarations ---

export interface SourceConnectorConfig {
  connector: string;
  [key: string]: unknown;
}

export type LoaderDeclaration =
  | { type: "literal"; value: unknown }
  | { type: "ref"; $ref: string }
  | { type: "source"; $source: string | SourceConnectorConfig; ttl?: number; staleWhileRevalidate?: boolean; refresh?: "eager" | "lazy" }
  | { type: "prompt"; $prompt: PromptDeclaration }
  | { type: "external"; docRef: string; fieldPath: string };

export interface PromptDeclaration {
  /** Template string with {fieldName} placeholders */
  template: string;
  /** Model to use (defaults to "claude-sonnet-4-20250514") */
  model?: string;
}

// --- Codata Meta & Field ---

export interface CodataMeta {
  /** JSON Schema for this field's value */
  schema?: Record<string, unknown>;
  /** Human-readable description */
  description?: string;
  /** How to produce this field's value */
  loader: LoaderDeclaration;
}

export interface CodataField<T = unknown> {
  readonly path: string;
  readonly meta: CodataMeta;
  state: FieldState<T>;
}
