import type { CyclicDependencyError } from "./types.js";
import { detectCycle as detectCycleImpl } from "./cycle-detection.js";

export class DAG {
  /** node -> set of nodes it depends on (upstream) */
  private deps = new Map<string, Set<string>>();
  /** node -> set of nodes that depend on it (downstream) */
  private dependents = new Map<string, Set<string>>();

  addNode(path: string): void {
    if (!this.deps.has(path)) {
      this.deps.set(path, new Set());
    }
    if (!this.dependents.has(path)) {
      this.dependents.set(path, new Set());
    }
  }

  removeNode(path: string): void {
    const upstream = this.deps.get(path);
    if (upstream) {
      for (const dep of upstream) {
        this.dependents.get(dep)?.delete(path);
      }
    }
    const downstream = this.dependents.get(path);
    if (downstream) {
      for (const dep of downstream) {
        this.deps.get(dep)?.delete(path);
      }
    }
    this.deps.delete(path);
    this.dependents.delete(path);
  }

  addEdge(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    this.deps.get(from)!.add(to);
    this.dependents.get(to)!.add(from);
  }

  removeEdge(from: string, to: string): void {
    this.deps.get(from)?.delete(to);
    this.dependents.get(to)?.delete(from);
  }

  getNodes(): string[] {
    return [...this.deps.keys()];
  }

  getDirectDeps(path: string): string[] {
    return [...(this.deps.get(path) ?? [])];
  }

  getDependents(path: string): string[] {
    return [...(this.dependents.get(path) ?? [])];
  }

  hasNode(path: string): boolean {
    return this.deps.has(path);
  }

  /**
   * Detect if the graph has a cycle. Returns null if acyclic,
   * or a CyclicDependencyError with the cycle path.
   */
  detectCycle(): CyclicDependencyError | null {
    return detectCycleImpl(
      this.getNodes(),
      (id) => this.getDirectDeps(id),
      (id) => this.getDependents(id),
    );
  }

  /**
   * Export the DAG as a Graphviz DOT string for visualization/debugging.
   */
  toDot(options?: { title?: string; highlightDirty?: string[] }): string {
    const title = options?.title ?? "CoDoc DAG";
    const dirty = new Set(options?.highlightDirty ?? []);
    const lines: string[] = [];

    lines.push(`digraph "${title}" {`);
    lines.push("  rankdir=TB;");
    lines.push('  node [shape=box, style=filled, fillcolor="#e8f4fd", fontname="monospace"];');
    if (dirty.size > 0) {
      lines.push('  node [fillcolor="#e8f4fd"];');
    }
    lines.push("");

    for (const node of this.getNodes().sort()) {
      const label = node.replace(/"/g, '\\"');
      if (dirty.has(node)) {
        lines.push(`  "${label}" [fillcolor="#ffcccc", style="filled,bold"];`);
      } else {
        lines.push(`  "${label}";`);
      }
    }

    lines.push("");

    for (const node of this.getNodes().sort()) {
      for (const dep of this.getDirectDeps(node).sort()) {
        const from = dep.replace(/"/g, '\\"');
        const to = node.replace(/"/g, '\\"');
        lines.push(`  "${from}" -> "${to}";`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }
}
