import type { DataTree } from "@codoc/core";
import type { DAG } from "@codoc/graph";
import { evictSourceCache, buildConnectorCacheKey } from "@codoc/source";
import { propagateAndInvalidate } from "../wiring/dirty-helpers.js";

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
 */
export class SourceScheduler {
  private tree: DataTree;
  private dag: DAG;
  private timers = new Map<string, TimerEntry>();

  constructor(options: SourceSchedulerOptions) {
    this.tree = options.tree;
    this.dag = options.dag;
  }

  registerAll(): void {
    for (const path of this.tree.getAllPaths()) {
      this.register(path);
    }
  }

  register(path: string): boolean {
    const field = this.tree.getField(path);
    if (!field) return false;

    const decl = field.meta.loader;
    if (decl.type !== "source" || !decl.ttl || decl.ttl <= 0) return false;

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

    this.tree.observe(path).then(
      () => {
        propagateAndInvalidate(this.dag, this.tree, [path]);
      },
      (err) => {
        console.error(`[SourceScheduler] eager refresh failed for ${path}:`, err);
      },
    );
  }

  unregister(path: string): boolean {
    const entry = this.timers.get(path);
    if (!entry) return false;
    clearInterval(entry.timerId);
    this.timers.delete(path);
    return true;
  }

  dispose(): void {
    for (const entry of this.timers.values()) {
      clearInterval(entry.timerId);
    }
    this.timers.clear();
  }

  get size(): number {
    return this.timers.size;
  }
}
