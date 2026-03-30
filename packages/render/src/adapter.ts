// Codata → rendering framework adapter layer.
// Adapts codata tree values for use with React Suspense and other rendering frameworks.

import type { DataTree } from "@codoc/core";

export interface RenderAdapter {
  /** Get the current snapshot of a field's value for rendering */
  getFieldValue(path: string): unknown;
  /** Subscribe to field changes (for useSyncExternalStore) */
  subscribe(path: string, callback: () => void): () => void;
}

export function createAdapter(tree: DataTree): RenderAdapter {
  return {
    getFieldValue(path: string): unknown {
      const field = tree.getField(path);
      if (!field) return undefined;
      if (field.state.status === "resolved") return field.state.value;
      return undefined;
    },
    subscribe(path: string, callback: () => void): () => void {
      return tree.subscribeField(path, callback);
    },
  };
}
