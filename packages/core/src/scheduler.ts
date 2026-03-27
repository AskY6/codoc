import type { DataTree } from "./data-tree.js";
import type { DAG } from "./dag.js";
import { topoLayers } from "./topo-sort.js";

export interface SchedulerOptions {
  /** Per-field timeout in milliseconds. 0 = no timeout. Default: 30000 */
  timeout?: number;
}

export interface SchedulerResult {
  /** Paths that resolved successfully */
  resolved: string[];
  /** Paths that failed, with their errors */
  errors: Array<{ path: string; error: unknown }>;
}

/**
 * Force all fields in the DAG using layer-parallel scheduling.
 * Fields within the same topological layer are forced concurrently via Promise.allSettled.
 * Layers are processed sequentially (layer N completes before layer N+1 starts).
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
      // Promise.allSettled on already-caught promises: all will be fulfilled
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
