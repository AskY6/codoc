import type { ComponentsMeta } from "../model/component.js";

export interface ComponentIssue {
  component: string;
  kind: "undeclared" | "missing_required_prop" | "unknown_prop";
  message: string;
  /** The prop name involved (for prop-level issues) */
  prop?: string;
}

export interface ComponentValidationResult {
  ok: boolean;
  issues: ComponentIssue[];
}

/**
 * Extract component usages from an MDX template string.
 *
 * Finds JSX-like tags: `<ComponentName prop1="val" prop2={expr} />`
 * Returns a map of component name → set of prop names used.
 */
export function extractComponentUsages(
  viewSource: string,
): Map<string, Set<string>> {
  const usages = new Map<string, Set<string>>();

  // Match opening tags: <ComponentName ...> or <ComponentName ... />
  // Component names start with uppercase (JSX convention)
  const tagPattern = /<([A-Z][A-Za-z0-9]*)(\s[^>]*)?\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(viewSource)) !== null) {
    const componentName = match[1];
    const attrString = match[2] ?? "";

    if (!usages.has(componentName)) {
      usages.set(componentName, new Set());
    }
    const props = usages.get(componentName)!;

    // Extract prop names from the attribute string
    // Matches: propName="..." or propName={...} or propName (boolean)
    const propPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|(?=\s|\/?>))/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propPattern.exec(attrString)) !== null) {
      props.add(propMatch[1]);
    }
  }

  return usages;
}

/**
 * Validate that a view template only uses declared components
 * and passes props consistent with their signatures.
 */
export function validateComponents(
  viewSource: string,
  componentsMeta: ComponentsMeta,
  /** Built-in component names that are always available (e.g. CodataValue) */
  builtins: Set<string> = new Set(["CodataValue"]),
): ComponentValidationResult {
  const issues: ComponentIssue[] = [];
  const usages = extractComponentUsages(viewSource);

  for (const [name, usedProps] of usages) {
    // Skip built-in components
    if (builtins.has(name)) continue;

    const signature = componentsMeta[name];
    if (!signature) {
      issues.push({
        component: name,
        kind: "undeclared",
        message: `Component <${name}> is used in view but not declared in meta.components`,
      });
      continue;
    }

    // Check for unknown props
    for (const prop of usedProps) {
      if (!(prop in signature.props)) {
        issues.push({
          component: name,
          kind: "unknown_prop",
          prop,
          message: `<${name}> received unknown prop "${prop}" (not in signature)`,
        });
      }
    }

    // Check for missing required props (props without "?" in type convention)
    // Since we don't have an optional marker, we skip this for now.
    // In future, PropMeta could have `required?: boolean`.
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
