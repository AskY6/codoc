import type {
  CodataField,
  CodataMeta,
  FieldState,
  LoaderDeclaration,
} from "../model/data.js";

/**
 * Determine the loader declaration for a data value.
 */
export function resolveLoaderDeclaration(value: unknown): LoaderDeclaration {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    if ("$ref" in obj && typeof obj["$ref"] === "string") {
      const ref = obj["$ref"];
      // Defer external ref detection to the caller (uses resolver module)
      return { type: "ref", $ref: ref };
    }
    if ("$source" in obj) {
      const raw = obj["$source"];
      if (typeof raw === "string" || (typeof raw === "object" && raw !== null && "connector" in (raw as Record<string, unknown>))) {
        return {
          type: "source",
          $source: raw as string | { connector: string; [key: string]: unknown },
          ttl: typeof obj["ttl"] === "number" ? obj["ttl"] : undefined,
          staleWhileRevalidate: typeof obj["staleWhileRevalidate"] === "boolean"
            ? obj["staleWhileRevalidate"]
            : undefined,
          refresh: obj["refresh"] === "eager" || obj["refresh"] === "lazy"
            ? obj["refresh"]
            : undefined,
        };
      }
    }
    if ("$prompt" in obj && typeof obj["$prompt"] === "object" && obj["$prompt"] !== null) {
      const prompt = obj["$prompt"] as Record<string, unknown>;
      if (typeof prompt["template"] === "string") {
        return {
          type: "prompt",
          $prompt: {
            template: prompt["template"],
            model: typeof prompt["model"] === "string" ? prompt["model"] : undefined,
          },
        };
      }
    }
  }
  return { type: "literal", value };
}

/**
 * Create a CodataField from meta and initial state.
 */
export function createField(
  path: string,
  meta: CodataMeta,
  state?: FieldState<unknown>,
): CodataField {
  return { path, meta, state: state ?? { status: "idle" } };
}
