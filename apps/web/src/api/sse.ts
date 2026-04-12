// SSE streaming client for agent turns.
//
// Uses fetch + ReadableStream (not EventSource, which only supports GET).
// Parses the SSE text protocol and dispatches typed events to callbacks.

import type {
  RunAgentTurnResponse,
  SSEErrorEvent,
  SSETitleUpdateEvent,
  SSETokenEvent,
  SSEToolCallEvent,
  SSEToolResultEvent,
} from "../types";

export interface StreamHandlers {
  onToken?: (event: SSETokenEvent) => void;
  onToolCall?: (event: SSEToolCallEvent) => void;
  onToolResult?: (event: SSEToolResultEvent) => void;
  onDone?: (event: RunAgentTurnResponse) => void;
  onTitleUpdate?: (event: SSETitleUpdateEvent) => void;
  onError?: (event: SSEErrorEvent) => void;
}

export interface StreamControl {
  abort: () => void;
}

export function runAgentTurnStream(
  threadId: string,
  content: string,
  handlers: StreamHandlers,
): StreamControl {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(threadId)}/turn`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        const text = await res.text();
        handlers.onError?.({ message: `HTTP ${res.status}: ${text}` });
        return;
      }

      if (!res.body) {
        handlers.onError?.({ message: "No response body" });
        return;
      }

      await parseSSEStream(res.body, handlers);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      handlers.onError?.({ message: String(error) });
    }
  })();

  return { abort: () => controller.abort() };
}

// Reconnect to an in-progress stream.
export function reconnectStream(
  threadId: string,
  handlers: StreamHandlers,
): StreamControl {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(threadId)}/stream`,
        { signal: controller.signal },
      );

      if (res.status === 204 || !res.body) return;

      await parseSSEStream(res.body, handlers);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      handlers.onError?.({ message: String(error) });
    }
  })();

  return { abort: () => controller.abort() };
}

// ---- SSE text protocol parser ---------------------------------------------

async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are delimited by blank lines.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const event = parseSSEEvent(part);
      if (event) dispatchSSEEvent(event, handlers);
    }
  }

  // Process any remaining data in the buffer.
  if (buffer.trim()) {
    const event = parseSSEEvent(buffer);
    if (event) dispatchSSEEvent(event, handlers);
  }
}

function parseSSEEvent(
  raw: string,
): { event: string; data: string } | null {
  let event = "";
  let data = "";

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice(5).trim();
    }
  }

  if (!event || !data) return null;
  return { event, data };
}

function dispatchSSEEvent(
  { event, data }: { event: string; data: string },
  handlers: StreamHandlers,
): void {
  try {
    switch (event) {
      case "token":
        handlers.onToken?.(JSON.parse(data) as SSETokenEvent);
        break;
      case "toolCall":
        handlers.onToolCall?.(JSON.parse(data) as SSEToolCallEvent);
        break;
      case "toolResult":
        handlers.onToolResult?.(JSON.parse(data) as SSEToolResultEvent);
        break;
      case "done":
        handlers.onDone?.(JSON.parse(data) as RunAgentTurnResponse);
        break;
      case "title-update":
        handlers.onTitleUpdate?.(JSON.parse(data) as SSETitleUpdateEvent);
        break;
      case "error":
        handlers.onError?.(JSON.parse(data) as SSEErrorEvent);
        break;
    }
  } catch {
    // Malformed JSON — ignore individual event
  }
}
