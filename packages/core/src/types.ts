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
  | { kind: "source"; message: string; url: string; retryable: boolean; cause?: unknown }
  | { kind: "prompt"; message: string; retryable: boolean; cause?: unknown };

// --- Codata Meta ---

export type LoaderDeclaration =
  | { type: "literal"; value: unknown }
  | { type: "ref"; $ref: string }
  | { type: "source"; $source: string; ttl?: number; staleWhileRevalidate?: boolean }
  | { type: "prompt"; $prompt: PromptDeclaration };

export interface PromptDeclaration {
  /** Template string with {fieldName} placeholders */
  template: string;
  /** Model to use (defaults to "claude-sonnet-4-20250514") */
  model?: string;
}

export interface CodataMeta {
  /** JSON Schema for this field's value */
  schema?: Record<string, unknown>;
  /** Human-readable description */
  description?: string;
  /** How to produce this field's value */
  loader: LoaderDeclaration;
}

// --- Codata Field ---

export interface CodataField<T = unknown> {
  readonly path: string;
  readonly meta: CodataMeta;
  state: FieldState<T>;
}

// --- Loader ---

export interface ForceContext {
  /** Force another field by path (for $ref resolution) */
  force: (path: string) => Promise<unknown>;
  /** Track paths currently being forced (cycle detection) */
  forceStack: Set<string>;
}

export type LoaderFn = (
  field: CodataField,
  context: ForceContext
) => Promise<unknown>;

// --- LLM Client (injected, not SDK-coupled) ---

export interface LLMClient {
  /**
   * Generate structured output from a prompt.
   * The implementation should enforce the provided JSON Schema on the output.
   */
  generate(options: {
    model: string;
    prompt: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}

// --- Validation ---

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: FieldError & { kind: "validation" };
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// --- Data Tree Definition ---

export interface CodataDefinition {
  type: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface CodocFile {
  type: Record<string, unknown>;
  data: Record<string, unknown>;
  view: string;
}
