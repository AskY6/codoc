/**
 * Manages field-level and global subscriptions.
 */
export class SubscriptionManager {
  private fieldListeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();

  /**
   * Subscribe to all field state changes. Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  /**
   * Subscribe to state changes for a specific field. Returns an unsubscribe function.
   */
  subscribeField(path: string, listener: () => void): () => void {
    let set = this.fieldListeners.get(path);
    if (!set) {
      set = new Set();
      this.fieldListeners.set(path, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.fieldListeners.delete(path);
    };
  }

  /**
   * Notify listeners for a specific field and all global listeners.
   */
  notify(path: string): void {
    const fieldSet = this.fieldListeners.get(path);
    if (fieldSet) {
      for (const fn of fieldSet) fn();
    }
    for (const fn of this.globalListeners) fn();
  }
}
