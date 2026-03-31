import YAML from "yaml";
import type { CodocFile, CodocMeta, ComponentsBody } from "@codoc/core";
import { parseComponentRef } from "@codoc/core";

/**
 * Parse a .codoc YAML file into a CodocFile.
 *
 * Expected format:
 *   { meta: { data, components?, view? }, data, components?, view }
 */
export function parseCodoc(source: string): CodocFile {
  const doc = YAML.parse(source);
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid .codoc file: expected a YAML document");
  }

  const raw = doc as Record<string, unknown>;
  const meta = raw["meta"] as Record<string, unknown> | undefined;

  const dataSchema = meta?.["data"] as Record<string, unknown> | undefined;
  if (!dataSchema || typeof dataSchema !== "object") {
    throw new Error(".codoc file missing 'meta.data' section (JSON Schema)");
  }

  const data = raw["data"];
  if (!data || typeof data !== "object") {
    throw new Error(".codoc file missing 'data' section");
  }

  const view = raw["view"];
  if (typeof view !== "string") {
    throw new Error(".codoc file missing 'view' section (MDX template)");
  }

  const codocMeta: CodocMeta = {
    data: dataSchema,
    components: parseComponentsMeta(meta?.["components"]),
    view: meta?.["view"],
  };

  const componentsBody = parseComponentsBody(raw["components"]);

  return {
    meta: codocMeta,
    data: data as Record<string, unknown>,
    components: componentsBody,
    view,
  };
}

function parseComponentsMeta(raw: unknown): CodocMeta["components"] {
  if (!raw || typeof raw !== "object") return undefined;
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

/** Serialize a CodocFile back to YAML source. */
export function serializeCodoc(codoc: CodocFile): string {
  const doc: Record<string, unknown> = {
    meta: codoc.meta,
    data: codoc.data,
    view: codoc.view,
  };
  if (codoc.components && Object.keys(codoc.components).length > 0) {
    doc.components = codoc.components;
  }
  return YAML.stringify(doc);
}
