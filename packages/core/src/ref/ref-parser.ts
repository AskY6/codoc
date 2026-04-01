import { RefError } from "../errors.js";
import type { Ref } from "./ref-types.js";

/**
 * Parse a `$ref` string into its path and field components.
 *
 * Format: `<relative-path>#<field-path>`
 * Example: `./other.codoc#data.summary` → `{ path: "./other.codoc", field: "data.summary" }`
 */
export function parseRef(refString: string): Ref {
  const hashIndex = refString.indexOf("#");

  if (hashIndex === -1) {
    throw new RefError(
      `Invalid ref format: missing "#" separator in "${refString}"`,
      refString,
    );
  }

  const path = refString.slice(0, hashIndex);
  const field = refString.slice(hashIndex + 1);

  if (!path) {
    throw new RefError(`Invalid ref format: empty path in "${refString}"`, refString);
  }
  if (!field) {
    throw new RefError(`Invalid ref format: empty field in "${refString}"`, refString);
  }

  return { path, field };
}
