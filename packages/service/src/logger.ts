// Structured loggers — console + file.
//
// Outputs one JSON line per log entry — AI-friendly and machine-parseable.
// These are the concrete implementations injected into NodeContext.log;
// the interface lives in @cobook/graph to keep the framework generic.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Logger, LogEntry } from "@cobook/graph";

type LogLevel = "debug" | "info" | "warn" | "error";

function formatLine(level: LogLevel, entry: LogEntry): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, ...entry });
}

// ---- Console logger -------------------------------------------------------

export function createConsoleLogger(): Logger {
  const write = (level: LogLevel, entry: LogEntry) => {
    const line = formatLine(level, entry);
    switch (level) {
      case "error":
        console.error(line);
        break;
      case "warn":
        console.warn(line);
        break;
      default:
        console.log(line);
    }
  };
  return {
    debug: (e) => write("debug", e),
    info: (e) => write("info", e),
    warn: (e) => write("warn", e),
    error: (e) => write("error", e),
  };
}

// ---- File logger ----------------------------------------------------------

/**
 * Creates a logger that appends JSON lines to a file.
 *
 * Files are written to `{logDir}/{threadId}-{timestamp}.jsonl`.
 * The directory is created on first call if it doesn't exist.
 */
export function createFileLogger(logDir: string, threadId: string): Logger {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(logDir, { recursive: true });
  const filePath = join(logDir, `${threadId}-${ts}.jsonl`);

  const write = (level: LogLevel, entry: LogEntry) => {
    appendFileSync(filePath, formatLine(level, entry) + "\n");
  };
  return {
    debug: (e) => write("debug", e),
    info: (e) => write("info", e),
    warn: (e) => write("warn", e),
    error: (e) => write("error", e),
  };
}

// ---- Compose loggers ------------------------------------------------------

/** Fan-out to multiple loggers. */
export function composeLoggers(...loggers: Logger[]): Logger {
  return {
    debug: (e) => loggers.forEach((l) => l.debug(e)),
    info: (e) => loggers.forEach((l) => l.info(e)),
    warn: (e) => loggers.forEach((l) => l.warn(e)),
    error: (e) => loggers.forEach((l) => l.error(e)),
  };
}
