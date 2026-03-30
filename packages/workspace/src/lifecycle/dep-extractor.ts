import type { CodataField, DataTree } from "@codoc/core";
import { extractTemplateVars } from "@codoc/source";

export interface ExternalDep {
  localPath: string;
  docRef: string;
  fieldPath: string;
}

/**
 * Extract intra-document dependency paths from a single field's meta.
 */
export function extractDeps(field: CodataField): string[] {
  const { loader } = field.meta;
  if (loader.type === "ref") {
    return [loader.$ref];
  }
  if (loader.type === "prompt") {
    return extractTemplateVars(loader.$prompt.template).map((v) => `/${v}`);
  }
  return [];
}

/**
 * Extract all intra-document dependency relationships from a DataTree.
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
