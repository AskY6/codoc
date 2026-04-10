/**
 * View block of a codoc.
 *
 * Intentionally minimal in this pass — just a sum of "has mdx body" vs
 * "no body". Richer view-node trees (stack / grid / tabs / …) can land
 * as additional variants later without breaking existing consumers.
 */
export type View =
  | { readonly kind: "mdx"; readonly source: string }
  | { readonly kind: "empty" };
