// diagnose — MDX-level static analysis for codoc files.
//
// Parses the MDX body into an MDAST via @mdx-js/mdx, then walks the tree
// to detect problems that would cause compilation or render failures:
//
//   1. Unknown JSX components — used but not imported and not a custom component
//   2. Unknown data fields   — {data.xxx} where xxx is not in frontmatter
//   3. MDX syntax errors     — malformed JSX, unclosed tags, etc.

import { createProcessor } from "@mdx-js/mdx";
import type { CodocAST } from "@cobook/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning";

export interface Diagnostic {
  readonly severity: Severity;
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}

export interface DiagnoseContext {
  /** Names of custom components available from .codoc/components/ */
  readonly customComponentNames: ReadonlySet<string>;
  /** Names of built-in components provided by the runtime */
  readonly builtinComponentNames?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run diagnostics on a codoc's MDX body.
 *
 * Returns an array of diagnostics. An empty array means the body is clean.
 * The caller decides whether errors should block a write.
 */
export function diagnoseCodoc(
  ast: CodocAST,
  ctx: DiagnoseContext,
): Diagnostic[] {
  if (ast.view.kind !== "mdx") return [];

  const source = ast.view.source;
  const dataFieldNames = new Set<string>(ast.data.keys());

  // 1. Parse MDX into MDAST
  let tree: { children: AnyNode[] };
  try {
    const processor = createProcessor({ format: "mdx" });
    tree = processor.parse(source);
  } catch (e: unknown) {
    // Parse failure — return a single syntax-error diagnostic
    const msg = e instanceof Error ? e.message : String(e);
    const pos = extractPosition(msg);
    return [{ severity: "error", message: `MDX syntax error: ${msg}`, ...pos }];
  }

  // 2. Collect imports and JSX usages from the AST
  const imported = new Set<string>();
  const jsxUsages: Array<{ name: string; line?: number; column?: number }> = [];
  const dataRefs: Array<{ field: string; line?: number; column?: number }> = [];

  walkTree(tree.children, imported, jsxUsages, dataRefs);

  // 3. Cross-reference
  const diagnostics: Diagnostic[] = [];

  const available = new Set([
    ...imported,
    ...ctx.customComponentNames,
    ...(ctx.builtinComponentNames ?? []),
  ]);

  for (const usage of jsxUsages) {
    // Extract root identifier for namespace access (e.g. "ns.Comp" → "ns")
    const root = usage.name.split(".")[0]!;
    if (!available.has(root)) {
      diagnostics.push({
        severity: "error",
        message: `Unknown component <${usage.name}>: not imported and not a custom component`,
        line: usage.line,
        column: usage.column,
      });
    }
  }

  for (const ref of dataRefs) {
    if (!dataFieldNames.has(ref.field)) {
      diagnostics.push({
        severity: "warning",
        message: `Unknown data field "data.${ref.field}": not declared in frontmatter`,
        line: ref.line,
        column: ref.column,
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// AST walking
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = Record<string, any>;

/**
 * Recursively walk MDAST nodes and collect:
 * - imported identifiers (from mdxjsEsm)
 * - JSX component usages (from mdxJsxFlowElement / mdxJsxTextElement)
 * - data.xxx references (from expressions and JSX attribute values)
 */
function walkTree(
  nodes: readonly AnyNode[],
  imported: Set<string>,
  jsxUsages: Array<{ name: string; line?: number; column?: number }>,
  dataRefs: Array<{ field: string; line?: number; column?: number }>,
): void {
  for (const node of nodes) {
    switch (node["type"]) {
      case "mdxjsEsm":
        collectImports(node, imported);
        break;

      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
        collectJsxUsage(node, jsxUsages);
        collectDataRefsFromAttributes(node, dataRefs);
        break;

      case "mdxFlowExpression":
      case "mdxTextExpression":
        collectDataRefsFromEstree(node["data"]?.["estree"], node["position"], dataRefs);
        break;
    }

    // Recurse into children
    if (Array.isArray(node["children"])) {
      walkTree(node["children"] as AnyNode[], imported, jsxUsages, dataRefs);
    }
  }
}

/**
 * Extract imported identifier names from an mdxjsEsm node's estree.
 */
function collectImports(node: AnyNode, imported: Set<string>): void {
  const body: AnyNode[] | undefined = node["data"]?.["estree"]?.["body"];
  if (!body) return;

  for (const stmt of body) {
    if (stmt["type"] !== "ImportDeclaration") continue;
    const specifiers: AnyNode[] | undefined = stmt["specifiers"];
    if (!specifiers) continue;

    for (const spec of specifiers) {
      const name: string | undefined = spec["local"]?.["name"];
      if (name) imported.add(name);
    }
  }
}

/**
 * Record a JSX component usage if the tag name is PascalCase (not HTML builtin).
 * HTML builtins are lowercase; custom components are PascalCase by JSX convention.
 */
function collectJsxUsage(
  node: AnyNode,
  jsxUsages: Array<{ name: string; line?: number; column?: number }>,
): void {
  const name: string | null | undefined = node["name"];
  if (!name) return; // fragment — skip

  // Lowercase first char → HTML builtin (div, span, table, etc.)
  if (name[0] === name[0]!.toLowerCase() && !name.includes(".")) return;

  jsxUsages.push({
    name,
    line: node["position"]?.["start"]?.["line"],
    column: node["position"]?.["start"]?.["column"],
  });
}

/**
 * Extract data.xxx references from JSX attribute value expressions.
 */
function collectDataRefsFromAttributes(
  node: AnyNode,
  dataRefs: Array<{ field: string; line?: number; column?: number }>,
): void {
  const attrs: AnyNode[] | undefined = node["attributes"];
  if (!attrs) return;

  for (const attr of attrs) {
    const value = attr["value"];
    if (value && typeof value === "object" && value["type"] === "mdxJsxAttributeValueExpression") {
      collectDataRefsFromEstree(value["data"]?.["estree"], attr["position"], dataRefs);
    }
  }
}

/**
 * Walk an estree program to find all `data.xxx` member expressions.
 * Handles both `data.field` and `data.field * N` patterns.
 */
function collectDataRefsFromEstree(
  estree: AnyNode | undefined,
  fallbackPosition: AnyNode | undefined,
  dataRefs: Array<{ field: string; line?: number; column?: number }>,
): void {
  if (!estree) return;

  walkEstree(estree, (expr: AnyNode) => {
    if (
      expr["type"] === "MemberExpression" &&
      !expr["computed"] &&
      expr["object"]?.["type"] === "Identifier" &&
      expr["object"]["name"] === "data" &&
      expr["property"]?.["type"] === "Identifier"
    ) {
      const loc = expr["property"]["loc"]?.["start"] ?? fallbackPosition?.["start"];
      dataRefs.push({
        field: expr["property"]["name"] as string,
        line: loc?.["line"],
        column: loc?.["column"],
      });
    }
  });
}

/**
 * Depth-first walk over every node in an estree.
 */
function walkEstree(node: AnyNode, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") walkEstree(item as AnyNode, visit);
      }
    } else if (value && typeof value === "object") {
      walkEstree(value as AnyNode, visit);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try to extract line/column from an error message string.
 * @mdx-js/mdx error messages often include "N:M:" or "(N:M)" patterns.
 */
function extractPosition(msg: string): { line?: number; column?: number } {
  const m = msg.match(/(\d+):(\d+)/);
  if (m) return { line: Number(m[1]), column: Number(m[2]) };
  return {};
}
