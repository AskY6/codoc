import {
  DataTree,
  DAG,
  parseCodoc,
  propagateAndInvalidate,
  scheduleForce,
  evictSourceCache,
  DocRegistry,
  setDocRegistry,
  wireExternalDeps,
  crossDocPropagate,
  detectDocCycle,
} from "@codoc/core";
import type { CodocFile, SchedulerResult } from "@codoc/core";

export class CodocRuntime {
  readonly file: CodocFile;
  readonly tree: DataTree;
  readonly dag: DAG;

  constructor(source: string) {
    this.file = parseCodoc(source);
    this.tree = new DataTree({ type: this.file.type, data: this.file.data });
    this.dag = DAG.buildFromTree(this.tree);

    // Check for cycles at build time
    const cycle = this.dag.detectCycle();
    if (cycle) throw cycle;
  }

  /**
   * Update a data field and propagate changes through the dependency graph.
   * Call from console: codoc.update("/title", "New Value")
   */
  async update(path: string, value: unknown): Promise<void> {
    // 1. Update the field value
    this.tree.updateField(path, value);

    // 2. Propagate dirty to downstream dependents
    const dirtyPaths = propagateAndInvalidate(this.dag, this.tree, [path]);

    // 3. Re-force all dirty fields in topological order
    for (const dirtyPath of dirtyPaths) {
      await this.tree.observe(dirtyPath);
    }
  }

  /**
   * Re-fetch a field from its original loader (e.g. re-request $source URL).
   * Evicts source cache if applicable, then re-forces and propagates.
   * Call from console: codoc.refresh("/todo")
   */
  async refresh(path: string): Promise<unknown> {
    const field = this.tree.getField(path);
    if (!field) throw new Error(`Field not found: ${path}`);

    // Evict source cache so the loader actually re-fetches
    if (field.meta.loader.type === "source") {
      evictSourceCache(field.meta.loader.$source);
    }

    // Reset to idle → next observe re-runs the original loader
    this.tree.refreshField(path);
    const value = await this.tree.observe(path);

    // Propagate to dependents
    const dirtyPaths = propagateAndInvalidate(this.dag, this.tree, [path]);
    for (const dirtyPath of dirtyPaths) {
      await this.tree.observe(dirtyPath);
    }

    return value;
  }

  /**
   * Force all fields using the layer-parallel scheduler.
   * Same-layer fields (no mutual dependencies) are forced concurrently.
   */
  async forceAll(): Promise<SchedulerResult> {
    return scheduleForce(this.tree, this.dag);
  }

  /**
   * Pre-process the MDX view template.
   * Replaces {fieldName} with <CodataValue path="/fieldName" /> for React rendering.
   */
  preprocessView(): string {
    const fieldNames = Object.keys(this.file.data);
    let view = this.file.view;
    for (const name of fieldNames) {
      view = view.replace(
        new RegExp(`\\{${name}\\}`, "g"),
        `<CodataValue path="/${name}" />`,
      );
    }
    return view;
  }
}

/**
 * Multi-document runtime for M4 cross-document references.
 * Manages a DocRegistry and wires cross-doc subscriptions.
 */
export class MultiDocRuntime {
  readonly registry: DocRegistry;
  private runtimes = new Map<string, CodocRuntime>();

  constructor() {
    this.registry = new DocRegistry();
    setDocRegistry(this.registry);
  }

  /**
   * Add a document to the multi-doc runtime.
   */
  addDoc(docId: string, source: string): CodocRuntime {
    const rt = new CodocRuntime(source);
    this.registry.register(docId, rt.tree, rt.dag);
    this.runtimes.set(docId, rt);
    return rt;
  }

  /**
   * Wire all cross-doc subscriptions and check for doc-level cycles.
   * Call after all docs have been added.
   */
  wireAll(): void {
    // Check for doc-level cycles before wiring
    const cycle = detectDocCycle(this.registry);
    if (cycle) {
      throw new Error(`Cyclic cross-document dependency: ${cycle.join(" → ")}`);
    }

    for (const docId of this.registry.getAllDocIds()) {
      wireExternalDeps(this.registry, docId);
    }
  }

  /**
   * Force all fields in all documents.
   */
  async forceAll(): Promise<void> {
    for (const [, rt] of this.runtimes) {
      await rt.forceAll();
    }
  }

  /**
   * Update a field in a specific document and propagate cross-doc.
   * Call from console: codoc.update("B.codoc", "/title", "New Value")
   */
  async update(docId: string, path: string, value: unknown): Promise<void> {
    const rt = this.runtimes.get(docId);
    if (!rt) throw new Error(`Document not found: ${docId}`);

    await rt.update(path, value);
    await crossDocPropagate(this.registry, docId, [path]);
  }

  getRuntime(docId: string): CodocRuntime | undefined {
    return this.runtimes.get(docId);
  }
}
