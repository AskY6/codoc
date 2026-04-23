// chat-meta — lightweight chat metadata persisted as <sourceDir>/chats.json.
//
// Each entry stores just enough to list past conversations and resume them
// via Claude Code's session ID. Full conversation history lives in
// ~/.claude/projects/<path>/<sessionId>.jsonl — we never duplicate it.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface ChatMeta {
  sessionId: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  mentions: string[];
}

const FILENAME = "chats.json";

function filePath(sourceDir: string): string {
  return join(sourceDir, FILENAME);
}

export async function loadChatMetas(sourceDir: string): Promise<ChatMeta[]> {
  try {
    const raw = await readFile(filePath(sourceDir), "utf-8");
    return JSON.parse(raw) as ChatMeta[];
  } catch {
    return [];
  }
}

export async function upsertChatMeta(
  sourceDir: string,
  sessionId: string,
  patch: { title?: string; mentions?: string[] },
): Promise<void> {
  const metas = await loadChatMetas(sourceDir);
  const now = new Date().toISOString();
  const idx = metas.findIndex((m) => m.sessionId === sessionId);
  if (idx >= 0) {
    metas[idx]!.lastActiveAt = now;
  } else {
    metas.push({
      sessionId,
      title: patch.title ?? "Untitled",
      createdAt: now,
      lastActiveAt: now,
      mentions: patch.mentions ?? [],
    });
  }
  await writeFile(filePath(sourceDir), JSON.stringify(metas, null, 2) + "\n", "utf-8");
}

export async function deleteChatMeta(
  sourceDir: string,
  sessionId: string,
): Promise<boolean> {
  const metas = await loadChatMetas(sourceDir);
  const filtered = metas.filter((m) => m.sessionId !== sessionId);
  if (filtered.length === metas.length) return false;
  await writeFile(filePath(sourceDir), JSON.stringify(filtered, null, 2) + "\n", "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Session history — read messages from Claude Code's .jsonl session file
// ---------------------------------------------------------------------------

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: { name: string; status: "done" }[];
}

/**
 * Derive the Claude Code project directory for a given workspace CWD.
 * Claude encodes the absolute path by replacing `/` and `.` with `-`.
 */
function claudeProjectDir(cwd: string): string {
  const encoded = resolve(cwd).replace(/[/.]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

/** Read and parse session messages from a Claude Code .jsonl file. */
export async function readSessionMessages(
  sourceDir: string,
  sessionId: string,
): Promise<SessionMessage[]> {
  const sessionFile = join(claudeProjectDir(sourceDir), `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf-8");
  } catch {
    return []; // session file missing or cleaned up
  }

  const messages: SessionMessage[] = [];
  // Track pending assistant turn to merge consecutive assistant entries
  let pending: { text: string; toolCalls: { name: string; status: "done" }[] } | null = null;

  const flushPending = () => {
    if (pending && (pending.text || pending.toolCalls.length > 0)) {
      const msg: SessionMessage = { role: "assistant", text: pending.text };
      if (pending.toolCalls.length > 0) msg.toolCalls = pending.toolCalls;
      messages.push(msg);
    }
    pending = null;
  };

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const type = entry.type as string;
    if (type !== "user" && type !== "assistant") continue;
    if (entry.isSidechain) continue;

    const msg = entry.message as { content: unknown[] } | undefined;
    if (!msg?.content || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as Record<string, unknown>[];

    if (type === "user") {
      // Skip tool_result entries (internal tool responses)
      if (blocks.some((b) => b.type === "tool_result")) continue;

      // Flush any pending assistant turn before this user message
      flushPending();

      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text as string)
        .join("\n");
      if (text) {
        messages.push({ role: "user", text });
      }
    } else {
      // assistant — merge consecutive entries into one turn
      if (!pending) pending = { text: "", toolCalls: [] };

      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          if (pending.text) pending.text += "\n";
          pending.text += (block.text as string).replace(/^\n+/, "");
        } else if (block.type === "tool_use" && block.name) {
          pending.toolCalls.push({ name: block.name as string, status: "done" });
        }
        // skip thinking, tool_result, etc.
      }
    }
  }

  flushPending();
  return messages;
}
