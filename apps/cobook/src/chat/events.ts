import type { ChatEvents, Unsubscribe } from "./types.js";

type Listener<K extends keyof ChatEvents> = ChatEvents[K];

export class SessionEventEmitter {
  private listeners = new Map<keyof ChatEvents, Set<Listener<any>>>();

  on<K extends keyof ChatEvents>(event: K, handler: Listener<K>): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit<K extends keyof ChatEvents>(
    event: K,
    ...args: Parameters<ChatEvents[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (...a: any[]) => void)(...args);
    }
  }
}
