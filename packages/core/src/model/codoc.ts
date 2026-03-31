import type { CodataField } from "./data.js";
import type { ComponentsMeta, ComponentsBody } from "./component.js";

// --- Meta Layer ---

export interface CodocMeta {
  /** JSON Schema describing the data fields */
  data: Record<string, unknown>;
  /** Component signatures — props + description for each component */
  components?: ComponentsMeta;
  /** Reserved for view meta (TBD) */
  view?: unknown;
}

// --- Data Tree Definition ---

export interface CodataDefinition {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface CodocFile {
  /** Self-describing meta layer covering data, components, and view. */
  meta: CodocMeta;
  data: Record<string, unknown>;
  /** Explicit component declarations with bundle references. */
  components?: ComponentsBody;
  view: string;
}

// --- Helpers ---

/** Get the components meta (signatures), defaulting to empty */
export function getComponentsMeta(codoc: CodocFile): ComponentsMeta {
  return codoc.meta.components ?? {};
}

/** Get the components body (bundle refs), defaulting to empty */
export function getComponentsBody(codoc: CodocFile): ComponentsBody {
  return codoc.components ?? {};
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
