// compile — transforms a CodocAST + resolved data into a standalone MDX string.
//
// The output is a valid MDX file that:
// 1. Exports resolved data as `export const data = {...}`
// 2. Exports meta as `export const meta = {...}`
// 3. Contains the view body (MDX source) as-is
//
// This allows VSCode MDX preview (or any MDX renderer) to access
// the data without needing the codoc runtime.

import type { CodocAST, ResolveResult } from "@cobook/core";

export interface CompileInput {
  readonly ast: CodocAST;
  readonly resolvedData: Record<string, ResolveResult> | null;
}

export interface CompileOptions {
  /** When true, emit a YAML-style comment header with meta info. */
  readonly header?: boolean;
}

/**
 * Compile a codoc AST + resolved data into a standalone MDX string.
 *
 * The output is self-contained — all `$ref` values are inlined,
 * all source values are materialized. The MDX body can reference
 * `data.*` via the exported `data` object.
 */
export function compileCodoc(
  input: CompileInput,
  options?: CompileOptions,
): string {
  const { ast, resolvedData } = input;
  const parts: string[] = [];

  // Extract import lines from body and hoist them to the top
  let body = ast.view.kind === "mdx" ? ast.view.source : "";
  const importLines: string[] = [];
  if (body) {
    const lines = body.split("\n");
    const rest: string[] = [];
    for (const line of lines) {
      if (line.startsWith("import ")) {
        importLines.push(line);
      } else {
        rest.push(line);
      }
    }
    body = rest.join("\n").replace(/^\n+/, "");
  }

  // Imports first
  if (importLines.length > 0) {
    parts.push(...importLines);
    parts.push("");
  }

  // Header comment with meta
  if (options?.header !== false && ast.meta.title) {
    parts.push(`{/* ${ast.meta.title} */}`);
    parts.push("");
  }

  // Export resolved data as a JS object
  const dataObj = buildDataExport(resolvedData);
  if (dataObj !== null) {
    parts.push(`export const data = ${dataObj}`);
    parts.push("");
  }

  // Export meta
  const metaExport = buildMetaExport(ast);
  if (metaExport !== null) {
    parts.push(`export const meta = ${metaExport}`);
    parts.push("");
  }

  // View body — interpolate {data.xxx} with resolved values
  if (body) {
    parts.push(interpolateBody(body, resolvedData));
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Replace `{data.fieldName}` expressions in the MDX body with resolved values.
 * Also supports `{data.fieldName * N}` for computed values (useful in SVG).
 * VSCode MDX preview doesn't execute JS, so we inline the actual values.
 */
function interpolateBody(
  source: string,
  resolvedData: Record<string, ResolveResult> | null,
): string {
  if (!resolvedData) return source;

  // Negative lookbehind: skip {data.xxx} when preceded by `=` (JSX attribute value)
  return source.replace(
    /(?<!=)\{data\.(\w+)(?:\s*\*\s*(\d+(?:\.\d+)?))?\}/g,
    (_match, key: string, factor?: string) => {
      const result = resolvedData[key];
      if (!result || result.kind !== "ready") return _match;

      const v = result.value;
      if (v == null) return "";

      // Numeric multiplication: {data.score * 44}
      if (factor !== undefined && typeof v === "number") {
        const computed = v * parseFloat(factor);
        return String(Math.round(computed * 10) / 10);
      }

      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        return String(v);
      }
      if (Array.isArray(v)) {
        return v.map((item) => `- ${item}`).join("\n");
      }
      return JSON.stringify(v);
    },
  );
}

function buildDataExport(
  resolvedData: Record<string, ResolveResult> | null,
): string | null {
  if (!resolvedData) return null;

  const entries: Record<string, unknown> = {};
  let hasAny = false;

  for (const [key, result] of Object.entries(resolvedData)) {
    if (result.kind === "ready") {
      entries[key] = result.value;
      hasAny = true;
    } else {
      // Error fields become undefined (commented in output)
      entries[key] = undefined;
    }
  }

  if (!hasAny) return null;

  return serializeJsObject(entries);
}

function buildMetaExport(ast: CodocAST): string | null {
  const meta: Record<string, unknown> = {};
  let hasAny = false;

  if (ast.meta.title) {
    meta.title = ast.meta.title;
    hasAny = true;
  }
  if (ast.meta.description) {
    meta.description = ast.meta.description;
    hasAny = true;
  }
  if (ast.meta.tags.length > 0) {
    meta.tags = ast.meta.tags;
    hasAny = true;
  }

  if (!hasAny) return null;
  return serializeJsObject(meta);
}

/**
 * Serialize a plain object as a JavaScript object literal.
 * Uses JSON.stringify with 2-space indent for readability.
 */
function serializeJsObject(obj: Record<string, unknown>): string {
  // Filter out undefined values for cleaner output
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return JSON.stringify(clean, null, 2);
}
