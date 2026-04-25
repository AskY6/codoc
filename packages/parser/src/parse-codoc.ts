// parse-codoc — boundary parser that converts raw codoc content (YAML
// frontmatter + MDX body) into the canonical CodocAST from @cobook/core.
//
// Frontmatter format (flat top-level keys):
//
//   ---
//   title: "Review: Alice — Q1 2026"
//   description: "..."
//   tags: [review, q1-2026]
//   schema:
//     score_business: number
//   data:
//     source:
//       $ref: "./source.codoc#data.achievements"
//     score_business: 4
//   ---
//   <ScoreCard ... />
//
// Reserved top-level keys: title, description, tags, schema, data.
// Everything after the closing `---` is the MDX view body.

import type {
  CodocAST,
  CodocMeta,
  DataField,
  FetchStrategy,
  FieldName,
  FieldSchema,
  Result,
} from "@cobook/core";
import { FieldName as mkFieldName, err, ok, parseRef } from "@cobook/core";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Error ADT
// ---------------------------------------------------------------------------

export type ParseError =
  | { readonly kind: "invalid-yaml"; readonly message: string }
  | { readonly kind: "frontmatter-not-mapping"; readonly message: string }
  | {
      readonly kind: "invalid-ref";
      readonly field: string;
      readonly input: string;
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// Frontmatter splitting
// ---------------------------------------------------------------------------

function splitFrontmatter(
  content: string,
): { frontmatter: string; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return null;

  const closingIndex = trimmed.indexOf("\n---", firstNewline);
  if (closingIndex === -1) return null;

  const frontmatter = trimmed.slice(firstNewline + 1, closingIndex);
  const afterClosing = closingIndex + 4; // \n---
  const nextNewline = trimmed.indexOf("\n", afterClosing);
  const body =
    nextNewline === -1
      ? trimmed.slice(afterClosing).trim()
      : trimmed.slice(nextNewline + 1);

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Data field classification
// ---------------------------------------------------------------------------

function classifyDataField(
  key: string,
  value: unknown,
): Result<DataField, ParseError> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if ("$ref" in obj && typeof obj["$ref"] === "string") {
      const refResult = parseRef(obj["$ref"]);
      if (!refResult.ok) {
        return err({
          kind: "invalid-ref",
          field: key,
          input: obj["$ref"],
          message: refResult.error.kind,
        });
      }
      return ok({ kind: "ref", ref: refResult.value });
    }

    if ("$source" in obj && typeof obj["$source"] === "string") {
      const { $source, interval, ttl, ...params } = obj;

      let fetch: FetchStrategy;
      if (typeof interval === "number") {
        fetch = { kind: "periodic", interval };
      } else if (typeof ttl === "number") {
        fetch = { kind: "lazy", ttl };
      } else {
        fetch = { kind: "oneshot" };
      }

      return ok({ kind: "source" as const, source: $source as string, params, fetch });
    }
  }

  return ok({ kind: "static", value });
}

// ---------------------------------------------------------------------------
// Meta extraction
// ---------------------------------------------------------------------------

const EMPTY_META: CodocMeta = {
  title: null,
  description: null,
  tags: [],
  schema: new Map() as ReadonlyMap<FieldName, FieldSchema>,
};

function extractMeta(obj: Record<string, unknown>): CodocMeta {
  const title = typeof obj.title === "string" ? obj.title : null;
  const description =
    typeof obj.description === "string" ? obj.description : null;
  const tags: readonly string[] = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : [];

  const schema = new Map<FieldName, FieldSchema>();
  if (
    obj.schema != null &&
    typeof obj.schema === "object" &&
    !Array.isArray(obj.schema)
  ) {
    for (const [k, v] of Object.entries(
      obj.schema as Record<string, unknown>,
    )) {
      if (typeof v === "string") {
        schema.set(mkFieldName(k), { type: v });
      } else if (v != null && typeof v === "object" && "type" in v) {
        schema.set(mkFieldName(k), {
          type: String((v as Record<string, unknown>).type),
        });
      }
    }
  }

  return { title, description, tags, schema };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const EMPTY_DATA = new Map<FieldName, DataField>() as ReadonlyMap<
  FieldName,
  DataField
>;

const EMPTY_AST: CodocAST = {
  meta: EMPTY_META,
  data: EMPTY_DATA,
  view: { kind: "empty" },
};

export function parseCodoc(content: string): Result<CodocAST, ParseError> {
  if (!content.trim()) return ok(EMPTY_AST);

  const split = splitFrontmatter(content);

  // No frontmatter — entire content is MDX body.
  if (!split) {
    return ok({
      meta: EMPTY_META,
      data: EMPTY_DATA,
      view: { kind: "mdx", source: content.trim() },
    });
  }

  // Parse YAML frontmatter.
  let raw: unknown;
  try {
    raw = parseYaml(split.frontmatter);
  } catch (e) {
    return err({
      kind: "invalid-yaml",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // Empty frontmatter (e.g. just `---\n---`) — treat as MDX-only.
  if (raw == null) {
    const body = split.body.trim();
    return ok({
      meta: EMPTY_META,
      data: EMPTY_DATA,
      view: body ? { kind: "mdx", source: body } : { kind: "empty" },
    });
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return err({
      kind: "frontmatter-not-mapping",
      message: "Frontmatter must be a YAML mapping, not a scalar or sequence",
    });
  }

  const obj = raw as Record<string, unknown>;

  // Extract meta from top-level keys.
  const meta = extractMeta(obj);

  // Extract data fields.
  const data = new Map<FieldName, DataField>();
  if (
    obj.data != null &&
    typeof obj.data === "object" &&
    !Array.isArray(obj.data)
  ) {
    for (const [k, v] of Object.entries(
      obj.data as Record<string, unknown>,
    )) {
      const classified = classifyDataField(k, v);
      if (!classified.ok) return classified;
      data.set(mkFieldName(k), classified.value);
    }
  }

  // View from MDX body.
  const body = split.body.trim();
  const view = body
    ? ({ kind: "mdx", source: body } as const)
    : ({ kind: "empty" } as const);

  return ok({ meta, data, view });
}
