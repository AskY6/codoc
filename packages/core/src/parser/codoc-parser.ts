import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { ParseError } from "../errors.js";
import type { z } from "zod";
import {
  CodocMetaRawSchema,
  CodocRawSchema,
  type CodocAST,
  type CodocMeta,
  type DataField,
} from "./schema.js";

export function parseCodoc(content: string): CodocAST {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ParseError(`YAML syntax error: ${message}`);
  }

  if (raw == null) return {};

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ParseError("Codoc must be a YAML mapping at the top level");
  }

  let parsed: ReturnType<typeof CodocRawSchema.parse>;
  try {
    parsed = CodocRawSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      throw new ParseError(
        `Invalid codoc structure: ${first?.path.join(".") ?? ""} ${first?.message ?? "unknown error"}`,
      );
    }
    throw err;
  }

  const result: CodocAST = {};

  if (parsed.meta) {
    result.meta = normaliseMeta(parsed.meta);
  }

  if (parsed.data) {
    const data: Record<string, DataField> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      data[key] = classifyDataField(value);
    }
    result.data = data;
  }

  if (parsed.view !== undefined) {
    result.view = parsed.view;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyDataField(value: unknown): DataField {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if ("$ref" in obj && typeof obj["$ref"] === "string") {
      return { kind: "ref", $ref: obj["$ref"] };
    }

    if ("$source" in obj && typeof obj["$source"] === "string") {
      const { $source, ...params } = obj;
      return { kind: "source", source: $source, params };
    }
  }

  return { kind: "static", value };
}

function normaliseMeta(raw: z.infer<typeof CodocMetaRawSchema>): CodocMeta {
  const meta: CodocMeta = {};
  if (raw.title !== undefined) meta.title = raw.title;
  if (raw.description !== undefined) meta.description = raw.description;

  if (raw.schema) {
    const schema: Record<string, { type: string }> = {};
    for (const [key, val] of Object.entries(raw.schema)) {
      if (typeof val === "string") {
        schema[key] = { type: val };
      } else if (val !== null && typeof val === "object" && "type" in val) {
        schema[key] = { type: String((val as Record<string, unknown>).type) };
      }
    }
    meta.schema = schema;
  }

  return meta;
}
