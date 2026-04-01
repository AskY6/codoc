import { parse as parseYaml } from "yaml";

import { parseCodocRef } from "../ref/parse-codoc-ref.js";

import type {
  CodocMeta,
  ComponentSpec,
  FileViewSpec,
  ParsedCodoc,
  ViewSpec
} from "./types.js";
import type { DataSpec } from "../source-spec/types.js";

export function parseCodocText(filePath: string, text: string): ParsedCodoc {
  const parsed = parseYaml(text);

  if (!isRecord(parsed)) {
    throw new Error(`Codoc at "${filePath}" must parse to an object.`);
  }

  const codoc = expectString(parsed.codoc, `${filePath}: "codoc" must be a string.`);
  const id = expectString(parsed.id, `${filePath}: "id" must be a string.`);
  const meta = parseMeta(parsed.meta, filePath);
  const data = parseDataSection(parsed.data, filePath);
  const component = parseComponentSection(parsed.component, filePath);
  const view = parseViewSpec(parsed.view, filePath);

  return {
    codoc,
    id,
    filePath,
    ...(meta ? { meta } : {}),
    ...(data ? { data } : {}),
    ...(component ? { component } : {}),
    ...(view ? { view } : {})
  };
}

function parseMeta(input: unknown, filePath: string): CodocMeta | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    throw new Error(`${filePath}: "meta" must be an object if provided.`);
  }

  return input;
}

function parseDataSection(
  input: unknown,
  filePath: string
): Record<string, DataSpec> | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    throw new Error(`${filePath}: "data" must be an object if provided.`);
  }

  const data: Record<string, DataSpec> = {};

  for (const [key, value] of Object.entries(input)) {
    data[key] = parseDataSpec(value, `${filePath}#/data/${key}`);
  }

  return data;
}

function parseDataSpec(value: unknown, location: string): DataSpec {
  if (isRecord(value)) {
    const source = value.$source;

    if (source === "static") {
      return {
        kind: "static",
        value: value.value
      };
    }

    if (source === "file") {
      return {
        kind: "file",
        path: expectString(value.path, `${location}: file source requires "path".`),
        format: parseFileFormat(value.format, value.path)
      };
    }

    if (source === "codoc" || (source === undefined && typeof value.$ref === "string")) {
      return {
        kind: "codoc",
        ref: parseCodocRef(expectString(value.$ref, `${location}: codoc source requires "$ref".`)),
        ...(value.$default !== undefined ? { defaultValue: value.$default } : {})
      };
    }

    if (typeof source === "string") {
      throw new Error(`${location}: unsupported $source "${source}".`);
    }

    if (shouldTreatAsObjectShape(value)) {
      const fields: Record<string, DataSpec> = {};

      for (const [key, child] of Object.entries(value)) {
        fields[key] = parseDataSpec(child, `${location}/${key}`);
      }

      return {
        kind: "object",
        fields
      };
    }
  }

  return {
    kind: "static",
    value
  };
}

function parseComponentSection(
  input: unknown,
  filePath: string
): Record<string, ComponentSpec> | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    throw new Error(`${filePath}: "component" must be an object if provided.`);
  }

  const component: Record<string, ComponentSpec> = {};

  for (const [key, value] of Object.entries(input)) {
    component[key] = parseComponentSpec(value, `${filePath}#/component/${key}`);
  }

  return component;
}

function parseComponentSpec(value: unknown, location: string): ComponentSpec {
  if (!isRecord(value) || typeof value.$source !== "string") {
    throw new Error(`${location}: component definition requires "$source".`);
  }

  switch (value.$source) {
    case "local":
      return {
        kind: "local",
        path: expectString(value.path, `${location}: local component requires "path".`)
      };
    case "inline":
      return {
        kind: "inline",
        code: expectString(value.code, `${location}: inline component requires "code".`)
      };
    case "codoc":
      return {
        kind: "codoc",
        ref: expectString(value.$ref, `${location}: codoc component requires "$ref".`)
      };
    case "builtin":
      return {
        kind: "builtin",
        name: expectString(value.name, `${location}: builtin component requires "name".`)
      };
    case "remote":
      return {
        kind: "remote",
        ...(typeof value.package === "string" ? { package: value.package } : {}),
        ...(typeof value.url === "string" ? { url: value.url } : {}),
        ...(typeof value.export === "string" ? { export: value.export } : {})
      };
    default:
      throw new Error(`${location}: unsupported component source "${value.$source}".`);
  }
}

function parseViewSpec(input: unknown, filePath: string): ViewSpec | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "string") {
    return input;
  }

  if (isRecord(input) && input.$source === "file") {
    return {
      kind: "file",
      path: expectString(input.path, `${filePath}: file-backed view requires "path".`)
    } satisfies FileViewSpec;
  }

  throw new Error(`${filePath}: "view" must be a string or file source.`);
}

function parseFileFormat(format: unknown, pathValue: unknown): "text" | "json" | "yaml" | "csv" {
  if (format === "text" || format === "json" || format === "yaml" || format === "csv") {
    return format;
  }

  if (typeof pathValue === "string") {
    if (pathValue.endsWith(".json")) {
      return "json";
    }

    if (pathValue.endsWith(".yaml") || pathValue.endsWith(".yml")) {
      return "yaml";
    }

    if (pathValue.endsWith(".csv")) {
      return "csv";
    }
  }

  return "text";
}

function shouldTreatAsObjectShape(value: Record<string, unknown>): boolean {
  return Object.values(value).some((child) => {
    if (!isRecord(child)) {
      return false;
    }

    if (typeof child.$source === "string" || typeof child.$ref === "string") {
      return true;
    }

    return shouldTreatAsObjectShape(child);
  });
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
