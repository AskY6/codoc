import type { FieldName } from "./ids.js";
import type { DataField } from "./data.js";
import type { CodocMeta } from "./meta.js";
import type { View } from "./view.js";

/**
 * Fully-parsed structural form of a codoc. This is the shape downstream
 * modules (DAG builder, validators, resolvers) operate on. Raw YAML or
 * MDX text never reaches this layer.
 */
export interface CodocAST {
  readonly meta: CodocMeta;
  readonly data: ReadonlyMap<FieldName, DataField>;
  readonly view: View;
}
