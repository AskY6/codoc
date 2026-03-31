type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "debug";

interface LogMeta {
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function fmt(module: string, level: LogLevel, msg: string, meta?: LogMeta): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  return `${ts} [${module}] ${level.toUpperCase()} ${msg}${metaStr}`;
}

export interface Logger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}

export function createLogger(module: string): Logger {
  return {
    debug(msg, meta) {
      if (shouldLog("debug")) console.debug(fmt(module, "debug", msg, meta));
    },
    info(msg, meta) {
      if (shouldLog("info")) console.info(fmt(module, "info", msg, meta));
    },
    warn(msg, meta) {
      if (shouldLog("warn")) console.warn(fmt(module, "warn", msg, meta));
    },
    error(msg, meta) {
      if (shouldLog("error")) console.error(fmt(module, "error", msg, meta));
    },
  };
}
