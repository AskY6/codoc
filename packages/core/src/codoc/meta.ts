import type { FieldName } from "./ids.js";

/** Type tag for a declared field schema. Intentionally minimal for now. */
export interface FieldSchema {
  readonly type: string;
}

/**
 * Descriptive metadata block of a codoc.
 *
 * All fields are explicit — absent values use `null` / empty collection so
 * that `meta.tags` never forces callers to disambiguate "undefined" from
 * "empty".
 */
export interface CodocMeta {
  readonly title: string | null;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly schema: ReadonlyMap<FieldName, FieldSchema>;
}
