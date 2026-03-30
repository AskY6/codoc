import YAML from "yaml";
import type { CodocFile, CodocMeta, ComponentsBody } from "@codoc/core";
import { parseComponentRef } from "@codoc/core";

/**
 * Parse a .codoc YAML file into a CodocFile.
 *
 * Supports both the legacy format:
 *   { type, data, view }
 *
 * And the new meta format:
 *   { meta: { data, components, view }, data, components, view }
 *
 * In both cases, `type` is always populated for backward compatibility.
 */
export function parseCodoc(source: string): CodocFile {
  const doc = YAML.parse(source);
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid .codoc file: expected a YAML document");
  }

  const raw = doc as Record<string, unknown>;
  const meta = raw["meta"] as Record<string, unknown> | undefined;
  const legacyType = raw["type"] as Record<string, unknown> | undefined;

  // Resolve the data schema: prefer meta.data, fall back to top-level type
  const dataSchema = (meta?.["data"] as Record<string, unknown>) ?? legacyType;
  if (!dataSchema || typeof dataSchema !== "object") {
    throw new Error(".codoc file missing schema: need either 'meta.data' or 'type' section (JSON Schema)");
  }

  const data = raw["data"];
  if (!data || typeof data !== "object") {
    throw new Error(".codoc file missing 'data' section");
  }

  const view = raw["view"];
  if (typeof view !== "string") {
    throw new Error(".codoc file missing 'view' section (MDX template)");
  }

  // Build normalized meta
  const codocMeta: CodocMeta = {
    data: dataSchema,
    components: parseComponentsMeta(meta?.["components"]),
    view: meta?.["view"],
  };

  // Parse components body (bundle references)
  const componentsBody = parseComponentsBody(raw["components"]);

  return {
    type: dataSchema,
    meta: codocMeta,
    data: data as Record<string, unknown>,
    components: componentsBody,
    view,
  };
}

function parseComponentsMeta(raw: unknown): CodocMeta["components"] {
  if (!raw || typeof raw !== "object") return undefined;
  // Already in the right shape: Record<string, { props, description }>
  return raw as CodocMeta["components"];
}

function parseComponentsBody(raw: unknown): ComponentsBody | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const result: ComponentsBody = {};
  for (const [name, decl] of Object.entries(raw as Record<string, unknown>)) {
    if (decl && typeof decl === "object") {
      result[name] = { ref: parseComponentRef(decl as Record<string, unknown>) };
    }
  }
  return result;
}
