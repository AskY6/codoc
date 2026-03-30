import type { CodataField } from "../model/data.js";
import type { ForceContext, LoaderFn } from "../model/codoc.js";

export const literalLoader: LoaderFn = async (
  field: CodataField,
  _context: ForceContext
): Promise<unknown> => {
  const decl = field.meta.loader;
  if (decl.type !== "literal") {
    throw new Error(`literalLoader called on non-literal field: ${field.path}`);
  }
  return decl.value;
};
