import type { CodataField, FieldError } from "../model/data.js";
import type { ForceContext } from "../model/codoc.js";
import { getLoader } from "../loader/registry.js";
import { validate } from "../validation/schema-validator.js";

/**
 * Force a single field to resolve its value.
 * Calls the appropriate loader and validates against schema.
 */
export async function forceField(
  field: CodataField,
  context: ForceContext,
): Promise<unknown> {
  const loader = getLoader(field.meta.loader);
  const rawValue = await loader(field, context);

  // Validate against schema if present
  if (field.meta.schema) {
    const result = validate(field.meta.schema, rawValue, field.path);
    if (!result.ok) {
      throw result.error;
    }
  }

  return rawValue;
}

/**
 * Wrap an unknown error into a FieldError.
 */
export function wrapError(err: unknown): FieldError {
  if (typeof err === "object" && err !== null && "kind" in err) {
    return err as FieldError;
  }
  return {
    kind: "loader",
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  };
}
