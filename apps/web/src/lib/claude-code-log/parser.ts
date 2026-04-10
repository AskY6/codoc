import type {
  LogMessage,
  ToolCall,
  SessionStats,
  ParsedSession,
  SessionSummary,
  ToolBreakdownEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Line-level parsing
// ---------------------------------------------------------------------------

interface RawLine {
  type: string;
  [key: string]: unknown;
}

function tryParseLine(line: string): RawLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as RawLine;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extract conversation messages from raw JSONL lines
// ---------------------------------------------------------------------------

function extractAssistantContent(raw: RawLine): {
  text: string;
  toolCalls: ToolCall[];
  model?: string;
} {
  const msg = raw["message"] as Record<string, unknown> | undefined;
  if (!msg) return { text: "", toolCalls: [] };

  const contentBlocks = msg["content"];
  if (!Array.isArray(contentBlocks)) return { text: "", toolCalls: [] };

  let text = "";
  const toolCalls: ToolCall[] = [];

  for (const block of contentBlocks) {
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: String(block.id ?? ""),
        name: String(block.name ?? ""),
        input: (block.input as Record<string, unknown>) ?? {},
      });
    }
    // Skip "thinking" blocks — internal reasoning
  }

  const model = (msg["model"] as string) ?? undefined;
  return { text, toolCalls, model };
}

function extractUserContent(raw: RawLine): string {
  const msg = raw["message"] as Record<string, unknown> | undefined;
  if (!msg) return "";

  const content = msg["content"];
  if (typeof content === "string") return content;

  // Tool result arrays — skip for display purposes
  if (Array.isArray(content)) return "";

  return "";
}

/** Max chars to keep from a tool result for display */
const TOOL_RESULT_MAX = 800;

/** Extract tool_result blocks from a user message, keyed by tool_use_id */
function extractToolResults(
  raw: RawLine,
): Map<string, string> {
  const results = new Map<string, string>();
  const msg = raw["message"] as Record<string, unknown> | undefined;
  if (!msg) return results;

  const content = msg["content"];
  if (!Array.isArray(content)) return results;

  for (const block of content) {
    if (block.type !== "tool_result" || !block.tool_use_id) continue;

    let text = "";
    if (typeof block.content === "string") {
      text = block.content;
    } else if (Array.isArray(block.content)) {
      text = block.content
        .filter((c: Record<string, unknown>) => c.type === "text" && typeof c.text === "string")
        .map((c: Record<string, unknown>) => c.text as string)
        .join("\n");
    }
    if (text) {
      results.set(
        String(block.tool_use_id),
        text.length > TOOL_RESULT_MAX
          ? text.slice(0, TOOL_RESULT_MAX) + "…"
          : text,
      );
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Full session parse
// ---------------------------------------------------------------------------

/**
 * Parse a full JSONL file content into a structured session.
 *
 * Two post-processing passes:
 * 1. Attach tool results (from user tool_result messages) to their ToolCall.
 * 2. Merge consecutive tool-only assistant turns into a single message.
 */
export function parseSession(content: string): ParsedSession {
  const lines = content.split("\n");
  const rawMessages: LogMessage[] = [];
  const toolCounts = new Map<string, number>();
  // Collect tool results from user messages keyed by tool_use_id
  const allToolResults = new Map<string, string>();
  let version: string | undefined;
  let gitBranch: string | undefined;
  let sessionModel: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of lines) {
    const raw = tryParseLine(line);
    if (!raw) continue;

    // Pick up metadata from any message with these fields
    if (!version && typeof raw["version"] === "string") {
      version = raw["version"] as string;
    }
    if (!gitBranch && typeof raw["gitBranch"] === "string") {
      gitBranch = raw["gitBranch"] as string;
    }

    const timestamp = (raw["timestamp"] as string) ?? "";
    if (timestamp) {
      if (!startedAt) startedAt = timestamp;
      endedAt = timestamp;
    }

    if (raw.type === "user") {
      // Skip meta messages (system guidance)
      if (raw["isMeta"]) continue;

      // Collect tool results before skipping
      if (raw["sourceToolAssistantUUID"]) {
        const results = extractToolResults(raw);
        for (const [id, text] of results) {
          allToolResults.set(id, text);
        }
        continue;
      }

      const content = extractUserContent(raw);
      if (!content.trim()) continue;
      if (content.includes("<command-name>")) continue;

      rawMessages.push({ role: "user", content, timestamp });
    }

    if (raw.type === "assistant") {
      const { text, toolCalls, model } = extractAssistantContent(raw);
      if (!sessionModel && model) sessionModel = model;

      for (const tc of toolCalls) {
        toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
      }

      if (text.trim() || toolCalls.length > 0) {
        const msg: LogMessage = {
          role: "assistant",
          content: text,
          timestamp,
        };
        if (toolCalls.length > 0) msg.toolCalls = toolCalls;
        if (model) msg.model = model;
        rawMessages.push(msg);
      }
    }
  }

  // Pass 1: attach tool results to their ToolCall
  for (const msg of rawMessages) {
    if (!msg.toolCalls) continue;
    for (const tc of msg.toolCalls) {
      const result = allToolResults.get(tc.id);
      if (result) tc.result = result;
    }
  }

  // Pass 2: merge consecutive tool-only assistant turns
  const messages: LogMessage[] = [];
  for (const msg of rawMessages) {
    if (msg.role !== "assistant" || msg.content.trim()) {
      // Non-assistant or has text content — don't merge
      messages.push(msg);
      continue;
    }
    // Tool-only assistant message: merge into previous if also tool-only
    const prev = messages.length > 0 ? messages[messages.length - 1] : undefined;
    if (
      prev &&
      prev.role === "assistant" &&
      !prev.content.trim() &&
      prev.toolCalls
    ) {
      prev.toolCalls.push(...(msg.toolCalls ?? []));
      // Keep the latest timestamp
      prev.timestamp = msg.timestamp;
    } else {
      messages.push(msg);
    }
  }

  const toolBreakdown: ToolBreakdownEntry[] = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  const userMsgs = messages.filter((m) => m.role === "user");
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const totalToolCalls = toolBreakdown.reduce((sum, e) => sum + e.count, 0);

  const stats: SessionStats = {
    messageCount: messages.length,
    userMessageCount: userMsgs.length,
    assistantMessageCount: assistantMsgs.length,
    toolCallCount: totalToolCalls,
    toolBreakdown,
  };

  const result: ParsedSession = { messages, stats };
  if (version) result.version = version;
  if (gitBranch) result.gitBranch = gitBranch;
  if (sessionModel) result.model = sessionModel;
  if (startedAt) result.startedAt = startedAt;
  if (endedAt) result.endedAt = endedAt;
  if (startedAt && endedAt) {
    result.durationMs =
      new Date(endedAt).getTime() - new Date(startedAt).getTime();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lightweight session summary (parses only header + counts)
// ---------------------------------------------------------------------------

/**
 * Extract a lightweight summary from JSONL content without building full message list.
 */
export function parseSessionSummary(
  content: string,
  id: string,
  file: string,
): SessionSummary {
  const lines = content.split("\n");
  let startedAt = "";
  let endedAt = "";
  let userCount = 0;
  let assistantCount = 0;
  let toolCallCount = 0;
  let model: string | undefined;
  let gitBranch: string | undefined;

  for (const line of lines) {
    const raw = tryParseLine(line);
    if (!raw) continue;

    const ts = raw["timestamp"] as string | undefined;
    if (ts) {
      if (!startedAt) startedAt = ts;
      endedAt = ts;
    }

    if (!gitBranch && typeof raw["gitBranch"] === "string") {
      gitBranch = raw["gitBranch"] as string;
    }

    if (raw.type === "user" && !raw["isMeta"] && !raw["sourceToolAssistantUUID"]) {
      const msg = raw["message"] as Record<string, unknown> | undefined;
      const content = msg?.["content"];
      if (typeof content === "string" && content.trim() && !content.includes("<command-name>")) {
        userCount++;
      }
    }

    if (raw.type === "assistant") {
      assistantCount++;
      const msg = raw["message"] as Record<string, unknown> | undefined;
      if (!model && msg) {
        const m = msg["model"] as string | undefined;
        if (m) model = m;
      }
      const contentBlocks = msg?.["content"];
      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (block.type === "tool_use") toolCallCount++;
        }
      }
    }
  }

  const summary: SessionSummary = {
    id,
    file,
    startedAt: startedAt || new Date().toISOString(),
    endedAt: endedAt || startedAt || new Date().toISOString(),
    messageCount: userCount + assistantCount,
    userMessageCount: userCount,
    assistantMessageCount: assistantCount,
    toolCallCount,
  };
  if (model) summary.model = model;
  if (gitBranch) summary.gitBranch = gitBranch;
  return summary;
}

// ---------------------------------------------------------------------------
// Project name from directory name
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable project name from a Claude Code project directory name.
 * Directory names are like: `-Users-kxzhang-code-local-tool-codoc`
 */
export function projectNameFromDir(dirName: string): string {
  // Strip leading dash, split by dash, take last meaningful segments
  const parts = dirName.replace(/^-/, "").split("-");

  // Find the index after the home directory prefix (Users-username)
  // Pattern: Users, <username>, ...rest
  let startIdx = 0;
  if (parts[0] === "Users" && parts.length > 2) {
    startIdx = 2; // skip "Users" and username
  }

  const meaningful = parts.slice(startIdx);
  if (meaningful.length === 0) return dirName;

  return meaningful.join("/");
}
