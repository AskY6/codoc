import {
  DataTree,
  DAG,
  parseCodoc,
  propagateAndInvalidate,
} from "@codoc/core";
import type { CodocFile } from "@codoc/core";

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
