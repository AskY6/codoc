import type { CodataField } from "./types.js";
import type { DataTree } from "./data-tree.js";

/**
 * Extract dependency paths from a single field's meta (static analysis).
 * Returns an array of paths this field depends on.
 */
export function extractDeps(field: CodataField): string[] {
  const { loader } = field.meta;
  if (loader.type === "ref") {
    return [loader.$ref];
  }
  return [];
}

/**
 * Extract all dependency relationships from a DataTree.
 * Returns a Map from field path → array of paths it depends on.
 */
export function extractAllDeps(tree: DataTree): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  for (const path of tree.getAllPaths()) {
    const field = tree.getField(path);
    if (field) {
      deps.set(path, extractDeps(field));
    }
  }
  return deps;
}
