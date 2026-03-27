import type { CodataField } from "./types.js";
import type { DataTree } from "./data-tree.js";
import { extractTemplateVars } from "./loader/prompt.js";

export interface ExternalDep {
  /** Local field that has the external reference */
  localPath: string;
  /** Target document ID */
  docRef: string;
  /** Target field path in the external document */
  fieldPath: string;
}

/**
 * Extract intra-document dependency paths from a single field's meta.
 * Returns an array of local paths this field depends on.
 * External refs are excluded (they don't create intra-doc DAG edges).
 */
export function extractDeps(field: CodataField): string[] {
  const { loader } = field.meta;
  if (loader.type === "ref") {
    return [loader.$ref];
  }
  if (loader.type === "prompt") {
    return extractTemplateVars(loader.$prompt.template).map((v) => `/${v}`);
  }
  // External refs don't contribute to intra-doc DAG
  return [];
}

/**
 * Extract all intra-document dependency relationships from a DataTree.
 * Returns a Map from field path → array of local paths it depends on.
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

/**
 * Extract all cross-document (external) dependencies from a DataTree.
 * Returns an array of ExternalDep describing which local fields
 * reference which fields in which external documents.
 */
export function extractExternalDeps(tree: DataTree): ExternalDep[] {
  const result: ExternalDep[] = [];
  for (const path of tree.getAllPaths()) {
    const field = tree.getField(path);
    if (field && field.meta.loader.type === "external") {
      result.push({
        localPath: path,
        docRef: field.meta.loader.docRef,
        fieldPath: field.meta.loader.fieldPath,
      });
    }
  }
  return result;
}
