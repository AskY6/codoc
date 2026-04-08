// ---------------------------------------------------------------------------
// Claude Code JSONL log types
// ---------------------------------------------------------------------------

/** Supported JSONL line types */
export type LogLineType =
  | "user"
  | "assistant"
  | "system"
  | "progress"
  | "file-history-snapshot"
  | "queue-operation"
  | "last-prompt";

/** A single tool call from an assistant message */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Parsed conversation message (user or assistant) */
export interface LogMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  timestamp: string;
  model?: string;
}

/** Tool usage stats */
export interface ToolBreakdownEntry {
  tool: string;
  count: number;
}

/** Aggregate session statistics */
export interface SessionStats {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolBreakdown: ToolBreakdownEntry[];
}

/** Full parsed session */
export interface ParsedSession {
  messages: LogMessage[];
  stats: SessionStats;
  version?: string;
  gitBranch?: string;
  model?: string;
}

/** Lightweight summary for session listing (no full messages) */
export interface SessionSummary {
  id: string;
  file: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  model?: string;
  gitBranch?: string;
}

/** Project info derived from directory listing */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  sessionCount: number;
}
