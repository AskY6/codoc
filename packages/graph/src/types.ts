export interface CyclicDependencyError {
  kind: "cyclic_dependency";
  message: string;
  cycle: string[];
}

export interface ReactiveGraph {
  addNode(id: string): void;
  removeNode(id: string): void;
  addEdge(from: string, to: string): void;
  removeEdge(from: string, to: string): void;
  getNodes(): string[];
  getDirectDeps(id: string): string[];
  getDependents(id: string): string[];
  hasNode(id: string): boolean;
  detectCycle(): CyclicDependencyError | null;
  topoSort(): string[];
  topoLayers(): string[][];
  propagateDirty(changedPaths: string[]): string[];
}
