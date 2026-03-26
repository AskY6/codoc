import type { DataTree } from "./data-tree.js";
import { extractAllDeps } from "./dep-extractor.js";

export interface CyclicDependencyError {
  kind: "cyclic_dependency";
  message: string;
  cycle: string[];
}

export class DAG {
  /** node → set of nodes it depends on (upstream) */
  private deps = new Map<string, Set<string>>();
  /** node → set of nodes that depend on it (downstream) */
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
    // Remove all edges involving this node
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
    // from depends on to (to → from in data flow)
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
   * Uses Kahn's algorithm: if not all nodes are processed, there's a cycle.
   */
  detectCycle(): CyclicDependencyError | null {
    const inDegree = new Map<string, number>();
    for (const [node, deps] of this.deps) {
      inDegree.set(node, deps.size);
    }

    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) queue.push(node);
    }

    let processed = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      processed++;
      for (const dependent of this.dependents.get(node) ?? []) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (processed === this.deps.size) return null;

    // Find the actual cycle path via DFS
    const cycle = this.findCyclePath(inDegree);
    return {
      kind: "cyclic_dependency",
      message: `Cyclic dependency detected: ${cycle.join(" → ")}`,
      cycle,
    };
  }

  private findCyclePath(inDegree: Map<string, number>): string[] {
    // Nodes still with in-degree > 0 are part of cycles
    const inCycle = new Set<string>();
    for (const [node, degree] of inDegree) {
      if (degree > 0) inCycle.add(node);
    }

    if (inCycle.size === 0) return [];

    // DFS from any node in the cycle to trace the path
    const start = inCycle.values().next().value!;
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): string[] | null => {
      if (visited.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          return [...path.slice(cycleStart), node];
        }
        return null;
      }
      visited.add(node);
      path.push(node);
      for (const dep of this.deps.get(node) ?? []) {
        if (inCycle.has(dep)) {
          const result = dfs(dep);
          if (result) return result;
        }
      }
      path.pop();
      return null;
    };

    return dfs(start) ?? [start];
  }

  /**
   * Build a DAG from a DataTree by statically extracting dependencies.
   */
  static buildFromTree(tree: DataTree): DAG {
    const dag = new DAG();
    const allDeps = extractAllDeps(tree);

    for (const [path, deps] of allDeps) {
      dag.addNode(path);
      for (const dep of deps) {
        dag.addEdge(path, dep);
      }
    }

    return dag;
  }
}
