import YAML from "yaml";
import type { CodocFile } from "@codoc/core";

export function parseCodoc(source: string): CodocFile {
  const doc = YAML.parse(source);
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid .codoc file: expected a YAML document");
  }
  const { type, data, view } = doc as Record<string, unknown>;
  if (!type || typeof type !== "object") {
    throw new Error(".codoc file missing 'type' section (JSON Schema)");
  }
  if (!data || typeof data !== "object") {
    throw new Error(".codoc file missing 'data' section");
  }
  if (typeof view !== "string") {
    throw new Error(".codoc file missing 'view' section (MDX template)");
  }
  return {
    type: type as Record<string, unknown>,
    data: data as Record<string, unknown>,
    view,
  };
}
