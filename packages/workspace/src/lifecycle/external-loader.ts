import type { CodataField, FieldError, ForceContext, LoaderFn } from "@codoc/core";
import { getDocRegistry } from "./instance-store.js";

export const externalLoader: LoaderFn = async (
  field: CodataField,
  _context: ForceContext,
): Promise<unknown> => {
  const decl = field.meta.loader;
  if (decl.type !== "external") {
    throw new Error(`externalLoader called on non-external field: ${field.path}`);
  }

  const { docRef, fieldPath } = decl;

  const registry = getDocRegistry();
  if (!registry) {
    const error: FieldError = {
      kind: "external_ref",
      message: `No DocRegistry available — cannot resolve external ref [[${docRef}]]${fieldPath}`,
      docRef,
      fieldPath,
    };
    throw error;
  }

  const entry = registry.get(docRef);
  if (!entry) {
    const error: FieldError = {
      kind: "external_ref",
      message: `Document not found: "${docRef}" (referenced from ${field.path})`,
      docRef,
      fieldPath,
    };
    throw error;
  }

  const targetField = entry.tree.getField(fieldPath);
  if (!targetField) {
    const error: FieldError = {
      kind: "external_ref",
      message: `Field "${fieldPath}" not found in document "${docRef}" (referenced from ${field.path})`,
      docRef,
      fieldPath,
    };
    throw error;
  }

  return entry.tree.observe(fieldPath);
};
