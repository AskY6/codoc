import type { Ref } from "./ref.js";

/**
 * How a `$source` field is fetched and cached.
 *
 * - `oneshot`  — fetch once, cache forever (default when neither interval nor ttl).
 * - `periodic` — background scheduler refreshes every `interval` minutes.
 * - `lazy`     — revalidate on access when `ttl` minutes have elapsed.
 */
export type FetchStrategy =
  | { readonly kind: "oneshot" }
  | { readonly kind: "periodic"; readonly interval: number }
  | { readonly kind: "lazy"; readonly ttl: number };

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
 * - `source` — a named provider call with opaque parameters and a fetch strategy.
 */
export type DataField =
  | { readonly kind: "static"; readonly value: unknown }
  | { readonly kind: "ref"; readonly ref: Ref }
  | {
      readonly kind: "source";
      readonly source: string;
      /** Provider-specific params (url, path, etc). */
      readonly params: Readonly<Record<string, unknown>>;
      /** When and how to fetch / refresh. */
      readonly fetch: FetchStrategy;
    };
