// Active stream tracking for SSE.
//
// Allows reconnecting clients to replay buffered events from an
// in-progress agent turn. Each thread has at most one active stream;
// concurrent requests on the same thread are rejected with 409.
//
// Pattern ported from legacy/apps/server/src/routes/chat-routes.ts.

export interface SSEEvent {
  readonly event: string;
  readonly data: string; // already JSON-stringified
}

export interface ActiveStream {
  readonly events: SSEEvent[];
  readonly listeners: Set<(evt: SSEEvent) => void>;
  done: boolean;
}

const activeStreams = new Map<string, ActiveStream>();

export function getActiveStream(threadId: string): ActiveStream | undefined {
  return activeStreams.get(threadId);
}

export function hasActiveStream(threadId: string): boolean {
  const s = activeStreams.get(threadId);
  return s != null && !s.done;
}

export function createActiveStream(threadId: string): ActiveStream {
  const stream: ActiveStream = {
    events: [],
    listeners: new Set(),
    done: false,
  };
  activeStreams.set(threadId, stream);
  return stream;
}

export function emitToStream(stream: ActiveStream, evt: SSEEvent): void {
  stream.events.push(evt);
  for (const listener of stream.listeners) listener(evt);
}

export function closeActiveStream(
  threadId: string,
  stream: ActiveStream,
): void {
  stream.done = true;
  stream.listeners.clear();
  activeStreams.delete(threadId);
}
