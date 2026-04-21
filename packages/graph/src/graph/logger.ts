// Structured logger interface for graph execution.
//
// Pure types — no runtime dependencies. The concrete implementation
// (console, pino, etc.) is injected via NodeContext by the caller.

/**
 * A single structured log entry. AI-friendly: every field is a
 * flat key-value pair so entries serialise to one JSON line.
 *
 * `scope` identifies the subsystem ("executor", "tool-loop", "router").
 * `event` names the specific occurrence ("node:enter", "tool:call").
 * Additional fields carry context (nodeId, durationMs, etc.).
 */
export interface LogEntry {
  readonly scope: string;
  readonly event: string;
  readonly [key: string]: unknown;
}

/**
 * Minimal levelled logger. Implementations decide how to render
 * entries — the graph runtime only calls the interface.
 */
export interface Logger {
  debug(entry: LogEntry): void;
  info(entry: LogEntry): void;
  warn(entry: LogEntry): void;
  error(entry: LogEntry): void;
}

/** Silent logger — used when no logger is injected. */
const noop = () => {};
export const noopLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
