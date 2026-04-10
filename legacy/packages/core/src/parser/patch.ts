import { parseCodoc, stringifyYaml } from "./codoc-parser.js";
import type { CodocAST } from "./schema.js";

// ---------------------------------------------------------------------------
// patchCodocSource — pure YAML round-trip for a single data path
//
// Given the canonical codoc source (content), replaces the value at
// `dataPath` inside the frontmatter's `data` field and returns the new
// source. Ref/source field markers ($ref / $source) are preserved for
// sibling fields; only the field targeted by `dataPath` is overwritten.
// ---------------------------------------------------------------------------

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function patchCodocSource(
  content: string,
  dataPath: string,
  value: unknown,
): string {
  const parsed = parseCodoc(content);

  const rawData: Record<string, unknown> = {};
  if (parsed.data) {
    for (const [key, field] of Object.entries(parsed.data)) {
      switch (field.kind) {
        case "static":
          rawData[key] = field.value;
          break;
        case "ref":
          rawData[key] = { $ref: field.$ref };
          break;
        case "source":
          rawData[key] = { $source: field.source, ...field.params };
          break;
      }
    }
  }

  setNestedValue(rawData, dataPath, value);

  const body =
    parsed.view &&
    typeof parsed.view === "object" &&
    "source" in parsed.view &&
    typeof (parsed.view as { source: unknown }).source === "string"
      ? (parsed.view as { source: string }).source
      : undefined;

  return stringifyCodocDocument({
    ...(parsed.meta ? { meta: parsed.meta } : {}),
    data: rawData,
    ...(body ? { body } : {}),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set a value at a nested path like "articles[2].readAt".
 * Supports dot notation and bracket indexing. Rejects prototype-pollution
 * segments.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments: (string | number)[] = [];
  for (const part of path.split(".")) {
    const match = /^(\w+)\[(\d+)\]$/.exec(part);
    if (match) {
      segments.push(match[1]!, Number(match[2]!));
    } else {
      segments.push(part);
    }
  }

  if (segments.some((s) => typeof s === "string" && FORBIDDEN_SEGMENTS.has(s))) {
    throw new Error(`Forbidden path segment in "${path}"`);
  }

  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current == null || typeof current !== "object") {
      throw new Error(
        `Cannot traverse path "${path}": missing parent at segment "${seg}"`,
      );
    }
    current = (current as Record<string | number, unknown>)[seg];
  }

  const last = segments[segments.length - 1]!;
  if (current == null || typeof current !== "object") {
    throw new Error(`Cannot set value at path "${path}": parent is not an object`);
  }
  (current as Record<string | number, unknown>)[last] = value;
}

function stringifyCodocDocument(doc: {
  meta?: CodocAST["meta"];
  data?: Record<string, unknown>;
  body?: string;
}): string {
  const frontmatter: Record<string, unknown> = {};
  if (doc.meta) frontmatter["meta"] = doc.meta;
  if (doc.data) frontmatter["data"] = doc.data;

  const yaml = stringifyYaml(frontmatter).trim();
  const body = doc.body?.trim();

  if (!body) {
    return `---\n${yaml}\n---\n`;
  }

  return `---\n${yaml}\n---\n\n${body}\n`;
}
