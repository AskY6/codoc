import type { DataTree } from "./tree.js";

/**
 * Observe a field: if idle/dirty, triggers force. Returns the resolved value.
 * This is the primary API for consumers.
 */
export async function observe<T = unknown>(
  tree: DataTree,
  path: string,
): Promise<T> {
  return tree.force(path, new Set()) as Promise<T>;
}
