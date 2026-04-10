import type { Ref } from "./ref.js";

/**
 * A single `data` field inside a codoc.
 *
 * ADT with three variants — the kind tag discriminates, and each variant
 * carries only the fields that make sense for it. Illegal states
 * (e.g. a static value with a ref) are unrepresentable.
 *
 * - `static` — a literal value embedded in the codoc.
 * - `ref`    — a structured reference to another codoc's field. The ref is
 *              already parsed; no consumer needs to re-parse the raw string.
 * - `source` — a named provider call with opaque parameters.
 */
export type DataField =
  | { readonly kind: "static"; readonly value: unknown }
  | { readonly kind: "ref"; readonly ref: Ref }
  | {
      readonly kind: "source";
      readonly source: string;
      readonly params: Readonly<Record<string, unknown>>;
    };
