import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export { parseYaml, stringifyYaml };
import { ZodError } from "zod";
import { ParseError } from "../errors.js";
import type { z } from "zod";
import {
  CodocMetaRawSchema,
  CodocRawSchema,
  FrontmatterRawSchema,
  type CodocAST,
  type CodocMeta,
  type DataField,
  type MdxView,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Frontmatter detection and splitting
// ---------------------------------------------------------------------------

function splitFrontmatter(
  content: string,
): { frontmatter: string; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return null;
  const afterOpening = firstNewline + 1;

  // Find closing `---` at start of a line
  const closingIndex = trimmed.indexOf("\n---", afterOpening - 1);
  if (closingIndex === -1) return null;

  const frontmatter = trimmed.slice(afterOpening, closingIndex);
  // Skip past the closing `---` line
  const afterClosingDelim = closingIndex + 4; // \n + ---
  const nextNewline = trimmed.indexOf("\n", afterClosingDelim);
  const body =
    nextNewline === -1 ? trimmed.slice(afterClosingDelim).trim() : trimmed.slice(nextNewline + 1);

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// MDX format parser: frontmatter (meta + data) + MDX body
// ---------------------------------------------------------------------------

function parseMdxCodoc(content: string): CodocAST {
  const split = splitFrontmatter(content);
  if (!split) throw new ParseError("Invalid MDX format: missing frontmatter delimiters");

  const frontmatterYaml = split.frontmatter;
  const mdxBody = split.body.trim();

  let raw: unknown;
  try {
    raw = parseYaml(frontmatterYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ParseError(`Frontmatter YAML syntax error: ${message}`);
  }

  const result: CodocAST = {};

  if (raw != null) {
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new ParseError("Frontmatter must be a YAML mapping");
    }

    let parsed: ReturnType<typeof FrontmatterRawSchema.parse>;
    try {
      parsed = FrontmatterRawSchema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        throw new ParseError(
          `Invalid frontmatter structure: ${first?.path.join(".") ?? ""} ${first?.message ?? "unknown error"}`,
        );
      }
      throw err;
    }

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
  }

  if (mdxBody) {
    const view: MdxView = { type: "mdx", source: mdxBody };
    result.view = view;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Legacy YAML format parser
// ---------------------------------------------------------------------------

function parseYamlCodoc(content: string): CodocAST {
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
// Public API
// ---------------------------------------------------------------------------

export function parseCodoc(content: string): CodocAST {
  if (splitFrontmatter(content) !== null) {
    return parseMdxCodoc(content);
  }
  return parseYamlCodoc(content);
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
  if (raw.tags !== undefined) meta.tags = raw.tags;

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
