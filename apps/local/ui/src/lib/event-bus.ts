// event-bus — typed pub/sub for cross-component communication.
//
// Designed to be consumer-agnostic: any part of the app can subscribe.
// Currently used by the <Prompt> MDX component to trigger chat messages,
// but future consumers (e.g. agent panels, automation) can subscribe too.

type Listener<T> = (payload: T) => void;

interface EventMap {
  /** A component wants to send a prompt to the active chat. */
  "send-prompt": { prompt: string };
}

const listeners = new Map<string, Set<Listener<never>>>();

export function publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
  const set = listeners.get(event);
  if (set) for (const fn of set) fn(payload as never);
}

export function subscribe<K extends keyof EventMap>(
  event: K,
  handler: Listener<EventMap[K]>,
): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as Listener<never>);
  return () => {
    set!.delete(handler as Listener<never>);
  };
}
