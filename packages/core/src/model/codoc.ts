import type { CodataField } from "./data.js";

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

// --- Loader Interface ---

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
