import type { DataTree } from "./data-tree.js";
import type { DAG } from "./dag.js";
import { propagateAndInvalidate } from "./dirty-propagator.js";
import { evictSourceCache, buildConnectorCacheKey } from "./loader/source.js";

export interface SourceSchedulerOptions {
  tree: DataTree;
  dag: DAG;
}

interface TimerEntry {
  path: string;
  timerId: ReturnType<typeof setTimeout>;
}

/**
 * Manages TTL-based refresh timers for $source fields.
 *
 * Two strategies:
 * - eager: on expiry, evict cache → refreshField → observe → propagate dirty downstream
 * - lazy:  on expiry, invalidateField only (actual fetch deferred to next observe)
 *
 * Default strategy is "lazy".
 */
export class SourceScheduler {
  private tree: DataTree;
  private dag: DAG;
  private timers = new Map<string, TimerEntry>();

  constructor(options: SourceSchedulerOptions) {
    this.tree = options.tree;
    this.dag = options.dag;
  }

  /**
   * Scan the DataTree for all $source fields with TTL and register timers.
   */
  registerAll(): void {
    for (const path of this.tree.getAllPaths()) {
      this.register(path);
    }
  }

  /**
   * Register a timer for a single field if it's a $source with TTL.
   */
  register(path: string): boolean {
    const field = this.tree.getField(path);
    if (!field) return false;

    const decl = field.meta.loader;
    if (decl.type !== "source" || !decl.ttl || decl.ttl <= 0) return false;

    // Don't double-register
    if (this.timers.has(path)) return false;

    const ttlMs = decl.ttl * 1000;
    const strategy = decl.refresh ?? "lazy";
    const source = decl.$source;
    const cacheKey = typeof source === "string" ? source : buildConnectorCacheKey(source);

    const timerId = setInterval(() => {
      if (strategy === "eager") {
        this.eagerRefresh(path, cacheKey);
      } else {
        this.lazyRefresh(path);
      }
    }, ttlMs);

    this.timers.set(path, { path, timerId });
    return true;
  }

  private lazyRefresh(path: string): void {
    const invalidated = this.tree.invalidateField(path);
    if (invalidated) {
      propagateAndInvalidate(this.dag, this.tree, [path]);
    }
  }

  private eagerRefresh(path: string, cacheKey: string): void {
    evictSourceCache(cacheKey);
    this.tree.refreshField(path);

    // Fire-and-forget: observe triggers fetch, then propagate
    this.tree.observe(path).then(
      () => {
        propagateAndInvalidate(this.dag, this.tree, [path]);
      },
      (err) => {
        console.error(`[SourceScheduler] eager refresh failed for ${path}:`, err);
      },
    );
  }

  /**
   * Cancel a single field's timer.
   */
  unregister(path: string): boolean {
    const entry = this.timers.get(path);
    if (!entry) return false;
    clearInterval(entry.timerId);
    this.timers.delete(path);
    return true;
  }

  /**
   * Cancel all timers. Call on teardown.
   */
  dispose(): void {
    for (const entry of this.timers.values()) {
      clearInterval(entry.timerId);
    }
    this.timers.clear();
  }

  /**
   * Number of active timers (for testing).
   */
  get size(): number {
    return this.timers.size;
  }
}
