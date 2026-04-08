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

// ---------------------------------------------------------------------------
// Full session parse
// ---------------------------------------------------------------------------

/**
 * Parse a full JSONL file content into a structured session.
 */
export function parseSession(content: string): ParsedSession {
  const lines = content.split("\n");
  const messages: LogMessage[] = [];
  const toolCounts = new Map<string, number>();
  let version: string | undefined;
  let gitBranch: string | undefined;
  let sessionModel: string | undefined;

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

    if (raw.type === "user") {
      // Skip meta messages (system guidance)
      if (raw["isMeta"]) continue;

      const content = extractUserContent(raw);
      // Skip tool result messages (they have sourceToolAssistantUUID)
      if (raw["sourceToolAssistantUUID"]) continue;
      // Skip empty content
      if (!content.trim()) continue;
      // Skip slash commands
      if (content.includes("<command-name>")) continue;

      messages.push({ role: "user", content, timestamp });
    }

    if (raw.type === "assistant") {
      const { text, toolCalls, model } = extractAssistantContent(raw);
      if (!sessionModel && model) sessionModel = model;

      // Count tool usage
      for (const tc of toolCalls) {
        toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
      }

      // Only include messages with visible text
      if (text.trim() || toolCalls.length > 0) {
        const msg: LogMessage = {
          role: "assistant",
          content: text,
          timestamp,
        };
        if (toolCalls.length > 0) msg.toolCalls = toolCalls;
        if (model) msg.model = model;
        messages.push(msg);
      }
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
