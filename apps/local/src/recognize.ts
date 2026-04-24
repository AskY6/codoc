// recognize — pure recognition of component enhancement opportunities.
//
// Given a codoc's AST + resolved data + available components, identifies
// which data fields could benefit from component-based rendering.
// This is a pure function: no side effects, no filesystem access.

import type { CodocAST, ResolveResult } from "@cobook/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentMeta {
  readonly name: string;
  readonly description: string;
  readonly props: readonly { name: string; type: string; required: boolean }[];
  readonly template: string;
  readonly dataTypeHints: readonly string[];
}

export interface ComponentSuggestion {
  readonly name: string;
  readonly template: string;
  readonly isBuiltin: boolean;
}

export type FieldUsage = "not-referenced" | "raw-expression" | "already-enhanced";

export interface Enhancement {
  readonly field: string;
  readonly valueType: string;
  readonly currentUsage: FieldUsage;
  readonly suggestions: readonly ComponentSuggestion[];
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Built-in component metadata (server-side copy — no React imports)
// ---------------------------------------------------------------------------

export const BUILTIN_COMPONENT_META: readonly ComponentMeta[] = [
  {
    name: "Badge",
    description: "Colored pill displaying a value — status, score, or label.",
    props: [
      { name: "value", type: "string | number", required: true },
      { name: "label", type: "string", required: false },
      { name: "color", type: "blue | green | red | amber | purple | neutral", required: false },
    ],
    template: "<Badge value={data.FIELD} />",
    dataTypeHints: ["string", "number", "boolean"],
  },
  {
    name: "Progress",
    description: "Horizontal progress bar with value and max.",
    props: [
      { name: "value", type: "number", required: true },
      { name: "max", type: "number", required: false },
      { name: "label", type: "string", required: false },
    ],
    template: "<Progress value={data.FIELD} max={100} />",
    dataTypeHints: ["number"],
  },
  {
    name: "Table",
    description: "Data table auto-generated from an array of objects.",
    props: [
      { name: "data", type: "Array<Record<string, unknown>>", required: true },
      { name: "columns", type: "string[]", required: false },
    ],
    template: "<Table data={data.FIELD} />",
    dataTypeHints: ["array"],
  },
  {
    name: "Card",
    description: "Information card with title, value, and description.",
    props: [
      { name: "title", type: "string", required: false },
      { name: "value", type: "string | number", required: false },
      { name: "description", type: "string", required: false },
    ],
    template: '<Card title="Title" value={data.FIELD} />',
    dataTypeHints: ["number", "string", "object"],
  },
  {
    name: "Chart",
    description: "Simple bar chart from {label, value} data.",
    props: [
      { name: "data", type: "Array<{label: string, value: number}>", required: true },
      { name: "height", type: "number", required: false },
    ],
    template: "<Chart data={data.FIELD} />",
    dataTypeHints: ["array"],
  },
];

// ---------------------------------------------------------------------------
// Recognition (pure)
// ---------------------------------------------------------------------------

/**
 * Identify enhancement opportunities for a codoc's data fields.
 *
 * Pure function: `(AST, resolved, components) → Enhancement[]`
 */
export function recognizeEnhancements(
  ast: CodocAST,
  resolvedData: Record<string, ResolveResult> | null,
  availableComponents: readonly ComponentMeta[],
): Enhancement[] {
  const mdxSource = ast.view.kind === "mdx" ? ast.view.source : "";
  const enhancements: Enhancement[] = [];

  for (const [fieldName] of ast.data) {
    const resolved = resolvedData?.[fieldName] ?? null;
    const value = resolved?.kind === "ready" ? resolved.value : null;
    const valueType = describeType(value);

    // Check current usage in MDX body
    const usage = detectFieldUsage(fieldName, mdxSource);

    // Skip fields that are already rendered with a component
    if (usage === "already-enhanced") continue;

    // Find matching components
    const suggestions = matchComponents(fieldName, value, availableComponents);
    if (suggestions.length === 0) continue;

    const reason =
      usage === "not-referenced"
        ? `Field "${fieldName}" (${valueType}) is declared but not used in the view.`
        : `Field "${fieldName}" (${valueType}) is rendered as a raw expression. A component would provide richer visualization.`;

    enhancements.push({ field: fieldName, valueType, currentUsage: usage, suggestions, reason });
  }

  return enhancements;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Describe the runtime type of a resolved value. */
function describeType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      return "array<object>";
    }
    return "array";
  }
  return typeof value;
}

/**
 * Detect how a data field is used in the MDX body.
 *
 * - `already-enhanced`: appears inside a JSX component's props (e.g. `<Chart data={data.field} />`)
 * - `raw-expression`: appears as `{data.field}` standalone in text
 * - `not-referenced`: not mentioned at all
 */
function detectFieldUsage(fieldName: string, mdxSource: string): FieldUsage {
  const dataRef = `data.${fieldName}`;
  if (!mdxSource.includes(dataRef)) return "not-referenced";

  // Check if it's inside a JSX tag's props: <ComponentName ... data.field ... />
  // Pattern: data.field preceded by = or { inside a JSX tag context
  const jsxPropPattern = new RegExp(
    `<[A-Z][A-Za-z]*\\s[^>]*\\b${escapeRegExp(dataRef)}\\b[^>]*/?>`,
  );
  if (jsxPropPattern.test(mdxSource)) return "already-enhanced";

  return "raw-expression";
}

/** Match available components against a field's runtime value. */
function matchComponents(
  fieldName: string,
  value: unknown,
  components: readonly ComponentMeta[],
): ComponentSuggestion[] {
  const suggestions: ComponentSuggestion[] = [];
  const valueType = inferHintType(value);

  for (const comp of components) {
    if (!comp.dataTypeHints.includes(valueType)) continue;

    // For array types, apply extra heuristics
    if (valueType === "array" && comp.name === "Chart") {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        typeof value[0] !== "object" ||
        value[0] === null ||
        !("label" in value[0]) ||
        !("value" in value[0])
      ) {
        continue;
      }
    }

    suggestions.push({
      name: comp.name,
      template: comp.template.replace("FIELD", fieldName),
      isBuiltin: BUILTIN_COMPONENT_META.some((b) => b.name === comp.name),
    });
  }

  return suggestions;
}

/** Map a runtime value to a dataTypeHint string. */
function inferHintType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value; // "string" | "number" | "boolean"
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
