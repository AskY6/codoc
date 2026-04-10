export interface SchemaEntry {
  type: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
}

/**
 * Validate a data record against a schema definition.
 * Each schema entry specifies the expected type for a field.
 * Fields absent from `data` are skipped.
 */
export function validateSchema(
  schema: Record<string, SchemaEntry>,
  data: Record<string, unknown>,
): ValidationResult {
  const errors: { field: string; message: string }[] = [];

  for (const [field, entry] of Object.entries(schema)) {
    const value = data[field];
    if (value === undefined) continue;

    const actual = typeOf(value);
    if (actual !== entry.type) {
      errors.push({
        field,
        message: `Expected type "${entry.type}", got "${actual}"`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
