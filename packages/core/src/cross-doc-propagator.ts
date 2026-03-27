import type { DocRegistry } from "./doc-registry.js";
import { extractExternalDeps } from "./dep-extractor.js";
import { propagateAndInvalidate } from "./dirty-propagator.js";

/**
 * Cross-document dirty propagation.
 * When a field in a target doc changes, invalidate and re-force all
 * consumer fields across all documents that reference it.
 */
export async function crossDocPropagate(
  registry: DocRegistry,
  targetDocId: string,
  changedFieldPaths: string[],
): Promise<void> {
  for (const fieldPath of changedFieldPaths) {
    const consumers = registry.getConsumers(targetDocId, fieldPath);
    for (const consumer of consumers) {
      const entry = registry.get(consumer.docId);
      if (!entry) continue;

      // Invalidate the consumer field
      entry.tree.invalidateField(consumer.fieldPath);

      // Re-force the consumer field
      await entry.tree.observe(consumer.fieldPath);

      // Propagate within the consumer doc's own DAG
      const dirtyPaths = propagateAndInvalidate(
        entry.dag,
        entry.tree,
        [consumer.fieldPath],
      );
      for (const dirtyPath of dirtyPaths) {
        await entry.tree.observe(dirtyPath);
      }
    }
  }
}

/**
 * Wire up cross-document subscriptions for a document.
 * Scans the doc's external deps and registers consumers in the registry.
 * When a target field changes, the consumer field is automatically invalidated and re-forced.
 */
export function wireExternalDeps(
  registry: DocRegistry,
  docId: string,
): void {
  const entry = registry.get(docId);
  if (!entry) return;

  const externalDeps = extractExternalDeps(entry.tree);
  for (const dep of externalDeps) {
    registry.addConsumer(
      dep.docRef,
      dep.fieldPath,
      docId,
      dep.localPath,
      () => {
        // Async propagation — fire and forget (errors logged)
        crossDocPropagate(registry, dep.docRef, [dep.fieldPath]).catch((err) => {
          console.error(
            `[cross-doc] propagation error: ${dep.docRef}${dep.fieldPath} → ${docId}${dep.localPath}`,
            err,
          );
        });
      },
    );
  }
}

// --- Doc-level DAG ---

export interface DocDAGEdge {
  from: string;
  to: string;
}

/**
 * Build a document-level dependency graph from a DocRegistry.
 * Returns edges where "from" depends on "to" (from imports from to).
 */
export function buildDocDAG(registry: DocRegistry): {
  nodes: string[];
  edges: DocDAGEdge[];
} {
  const nodes = new Set<string>();
  const edges: DocDAGEdge[] = [];
  const edgeSet = new Set<string>();

  for (const docId of registry.getAllDocIds()) {
    nodes.add(docId);
    const entry = registry.get(docId);
    if (!entry) continue;

    const externalDeps = extractExternalDeps(entry.tree);
    for (const dep of externalDeps) {
      nodes.add(dep.docRef);
      const key = `${docId}->${dep.docRef}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ from: docId, to: dep.docRef });
      }
    }
  }

  return { nodes: [...nodes], edges };
}

/**
 * Detect cycles in the document-level dependency graph.
 * Returns the cycle path if found, or null if acyclic.
 */
export function detectDocCycle(
  registry: DocRegistry,
): string[] | null {
  const { nodes, edges } = buildDocDAG(registry);

  // Build adjacency list: from → [to, ...]
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node, []);
  }
  for (const { from, to } of edges) {
    adj.get(from)!.push(to);
  }

  // DFS cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) color.set(node, WHITE);

  const path: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      if (color.get(neighbor) === GRAY) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        return [...path.slice(cycleStart), neighbor];
      }
      if (color.get(neighbor) === WHITE) {
        const result = dfs(neighbor);
        if (result) return result;
      }
    }

    path.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of nodes) {
    if (color.get(node) === WHITE) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }

  return null;
}

/**
 * Export the doc-level DAG as a Graphviz DOT string.
 */
export function docDAGtoDot(
  registry: DocRegistry,
  options?: { title?: string },
): string {
  const title = options?.title ?? "CoDoc Document DAG";
  const { nodes, edges } = buildDocDAG(registry);
  const lines: string[] = [];

  lines.push(`digraph "${title}" {`);
  lines.push("  rankdir=TB;");
  lines.push('  node [shape=box, style=filled, fillcolor="#d4edda", fontname="monospace"];');
  lines.push("");

  for (const node of nodes.sort()) {
    const label = node.replace(/"/g, '\\"');
    lines.push(`  "${label}";`);
  }

  lines.push("");

  for (const { from, to } of edges) {
    const f = from.replace(/"/g, '\\"');
    const t = to.replace(/"/g, '\\"');
    lines.push(`  "${f}" -> "${t}";`);
  }

  lines.push("}");
  return lines.join("\n");
}
