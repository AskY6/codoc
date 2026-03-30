import Ajv from "ajv";
import type { ValidationResult } from "../model/schema.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export function validate<T>(
  schema: Record<string, unknown>,
  value: unknown,
  path: string
): ValidationResult<T> {
  const valid = ajv.validate(schema, value);
  if (valid) {
    return { ok: true, value: value as T };
  }
  const message = ajv.errorsText(ajv.errors, { separator: "; " });
  return {
    ok: false,
    error: { kind: "validation", message, path, schema },
  };
}
