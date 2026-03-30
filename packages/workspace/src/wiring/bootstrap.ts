import type { DataTree } from "@codoc/core";
import { registerLoader } from "@codoc/core";
import { DAG, topoLayers } from "@codoc/graph";
import { registerSourceLoaders } from "@codoc/source";
import { extractAllDeps } from "../lifecycle/dep-extractor.js";
import { externalLoader } from "../lifecycle/external-loader.js";

export interface SchedulerOptions {
  timeout?: number;
}

export interface SchedulerResult {
  resolved: string[];
  errors: Array<{ path: string; error: unknown }>;
}

/**
 * Build a DAG from a DataTree by statically extracting dependencies.
 */
export function buildDAGFromTree(tree: DataTree): DAG {
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

/**
 * Force all fields in the DAG using layer-parallel scheduling.
 */
export async function scheduleForce(
  tree: DataTree,
  dag: DAG,
  options?: SchedulerOptions
): Promise<SchedulerResult> {
  const timeout = options?.timeout ?? 30000;
  const layers = topoLayers(dag);

  const resolved: string[] = [];
  const errors: Array<{ path: string; error: unknown }> = [];

  for (const layer of layers) {
    const promises = layer.map((path) => {
      let promise = tree.observe(path);
      if (timeout > 0) {
        promise = withTimeout(promise, timeout, path);
      }
      return promise.then(
        () => ({ path, ok: true as const }),
        (error: unknown) => ({ path, ok: false as const, error }),
      );
    });

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.ok) {
          resolved.push(result.value.path);
        } else {
          errors.push({ path: result.value.path, error: result.value.error });
        }
      }
    }
  }

  return { resolved, errors };
}

function withTimeout<T>(promise: Promise<T>, ms: number, path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject({
        kind: "loader" as const,
        message: `Timeout after ${ms}ms forcing field: ${path}`,
      });
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Register all workspace-level loaders (external + source loaders).
 * Call once at workspace initialization.
 */
export function registerWorkspaceLoaders(): void {
  registerSourceLoaders();
  registerLoader("external", externalLoader);
}
