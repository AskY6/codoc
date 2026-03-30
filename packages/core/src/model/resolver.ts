/**
 * Cross-document reference resolver.
 * Parses external ref syntax: "[[B.codoc]]/fieldPath"
 */

export interface ExternalRef {
  docRef: string;
  fieldPath: string;
}

const EXTERNAL_REF_REGEX = /^\[\[([^\]]+)\]\]\/.+$/;

/**
 * Check if a $ref path is an external (cross-document) reference.
 */
export function isExternalRef(ref: string): boolean {
  return EXTERNAL_REF_REGEX.test(ref);
}

/**
 * Parse an external ref string into its components.
 * "[[B.codoc]]/title" → { docRef: "B.codoc", fieldPath: "/title" }
 * "[[B.codoc]]"       → error (field path required)
 *
 * Throws if the ref is not a valid external ref.
 */
const PARSE_REGEX = /^\[\[([^\]]+)\]\](\/.*)?$/;

export function parseExternalRef(ref: string): ExternalRef {
  const match = ref.match(PARSE_REGEX);
  if (!match) {
    throw new Error(`Invalid external ref: "${ref}" (expected [[docRef]]/fieldPath)`);
  }
  const docRef = match[1];
  const fieldPath = match[2];
  if (!fieldPath || fieldPath === "/") {
    throw new Error(
      `External ref "[[${docRef}]]" missing field path (expected [[docRef]]/fieldPath)`,
    );
  }
  return { docRef, fieldPath };
}
