import type { DocRegistry } from "../lifecycle/instance-store.js";
import type { SourceScheduler } from "./source-binding.js";
import { propagateAndInvalidate } from "../wiring/dirty-helpers.js";

export interface WatchEvent {
  kind: "source_changed" | "resource_added";
  docId: string;
  fieldPath?: string;
}

export type WatchHandler = (event: WatchEvent) => void | Promise<void>;

/**
 * Watch orchestrator: receives source watcher change signals
 * and routes them to the correct processing path.
 *
 * - source_changed on existing codoc → mark dirty + propagate
 * - resource_added in data source directory → trigger rescan
 */
export class WatchOrchestrator {
  private registry: DocRegistry;
  private scheduler: SourceScheduler | null;
  private handlers = new Set<WatchHandler>();

  constructor(registry: DocRegistry, scheduler?: SourceScheduler) {
    this.registry = registry;
    this.scheduler = scheduler ?? null;
  }

  /**
   * Handle a source change event.
   */
  async handleSourceChanged(docId: string, fieldPath: string): Promise<void> {
    const entry = this.registry.get(docId);
    if (!entry) return;

    entry.tree.refreshField(fieldPath);
    await entry.tree.observe(fieldPath);

    const dirtyPaths = propagateAndInvalidate(entry.dag, entry.tree, [fieldPath]);
    for (const path of dirtyPaths) {
      await entry.tree.observe(path);
    }

    await this.emit({ kind: "source_changed", docId, fieldPath });
  }

  /**
   * Register an external watch handler.
   */
  onEvent(handler: WatchHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private async emit(event: WatchEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }
}
