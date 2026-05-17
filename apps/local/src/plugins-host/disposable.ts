// Disposable — VS Code-style resource handle.
//
// Plugin activation accumulates resources (router mounts, jobs, MCP tools,
// event listeners) into a DisposableStore. When the workspace closes, the
// host disposes everything in reverse order — symmetric, no per-resource
// teardown branching.

export interface Disposable {
  dispose(): void;
}

export class DisposableStore implements Disposable {
  private readonly items: Disposable[] = [];
  private disposed = false;

  /** Add a disposable. If the store is already disposed, the item is disposed immediately. */
  add(item: Disposable): void {
    if (this.disposed) {
      item.dispose();
      return;
    }
    this.items.push(item);
  }

  /** Dispose all items in reverse order. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.items.length > 0) {
      const item = this.items.pop()!;
      try {
        item.dispose();
      } catch (e) {
        console.warn(
          `[plugin-host] disposable threw: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

/** Wrap an arbitrary teardown function as a Disposable. */
export function toDisposable(fn: () => void): Disposable {
  return { dispose: fn };
}
