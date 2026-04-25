// providers/codex — Codex CLI adapter via subprocess in JSONL mode.
//
// Uses `codex exec --json` for non-interactive streaming.
// No SDK dependency — we spawn the binary and parse JSONL events directly.

import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ChatProvider, ChatParams, ChatEvent, SessionMessage } from "./types.js";
import { readAgentInstructions } from "./types.js";

// ---------------------------------------------------------------------------
// Codex JSONL event types (subset we care about)
// ---------------------------------------------------------------------------

interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

interface CodexItemEvent extends CodexEvent {
  type: "item.started" | "item.updated" | "item.completed";
  item: {
    type: string;
    content?: Array<{ type: string; text?: string }>;
    name?: string;
    arguments?: string;
    output?: string;
    status?: string;
    [key: string]: unknown;
  };
}

interface CodexTurnEvent extends CodexEvent {
  type: "turn.completed";
  usage?: {
    total_tokens?: number;
    [key: string]: unknown;
  };
}

interface CodexThreadEvent extends CodexEvent {
  type: "thread.started";
  thread_id?: string;
}

// ---------------------------------------------------------------------------
// Event mapping: Codex JSONL → ChatEvent
// ---------------------------------------------------------------------------

function mapCodexEvent(raw: CodexEvent): ChatEvent[] {
  switch (raw.type) {
    case "thread.started": {
      const evt = raw as CodexThreadEvent;
      const id = evt.thread_id ?? `codex-${Date.now()}`;
      return [{ kind: "init", sessionId: id }];
    }

    case "item.started": {
      const evt = raw as CodexItemEvent;
      // Tool call started
      if (evt.item.type === "function_call" || evt.item.type === "tool_call") {
        return [{
          kind: "tool_use",
          name: evt.item.name ?? "unknown",
          input: tryParseJson(evt.item.arguments),
        }];
      }
      return [];
    }

    case "item.completed": {
      const evt = raw as CodexItemEvent;

      // Tool call completed
      if (evt.item.type === "function_call" || evt.item.type === "tool_call") {
        return [{ kind: "tool_result", name: evt.item.name ?? "unknown" }];
      }

      // Agent text message
      if (evt.item.type === "message") {
        const texts = (evt.item.content ?? [])
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text!);
        if (texts.length > 0) {
          return [{ kind: "text", text: texts.join("\n") }];
        }
      }

      return [];
    }

    case "turn.completed": {
      return [{ kind: "done" }];
    }

    case "turn.failed":
    case "error": {
      const message = typeof raw.message === "string"
        ? raw.message
        : typeof raw.error === "string"
          ? raw.error
          : "Codex error";
      return [{ kind: "error", message }];
    }

    default:
      return [];
  }
}

function tryParseJson(s?: string): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { raw: s };
  }
}

// ---------------------------------------------------------------------------
// JSONL line parser
// ---------------------------------------------------------------------------

function parseJsonlLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as CodexEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session history reader
// ---------------------------------------------------------------------------

async function readCodexSessionMessages(
  sessionId: string,
  _cwd: string,
): Promise<SessionMessage[]> {
  // Codex stores sessions under ~/.codex/sessions/ organized by date.
  // We search for the session file by ID.
  const sessionsDir = join(homedir(), ".codex", "sessions");

  // Try to find the session file — Codex organizes by date subdirs.
  // Best-effort: try flat path first, then scan date subdirs.
  let raw: string | null = null;

  // Direct path
  try {
    raw = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf-8");
  } catch {
    // Scan year/month/day subdirs
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const walk = (dir: string): string | null => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (entry === `${sessionId}.jsonl`) return full;
          try {
            if (statSync(full).isDirectory()) {
              const found = walk(full);
              if (found) return found;
            }
          } catch { continue; }
        }
        return null;
      };
      const found = walk(sessionsDir);
      if (found) raw = await readFile(found, "utf-8");
    } catch { /* sessions dir doesn't exist */ }
  }

  if (!raw) return [];

  const messages: SessionMessage[] = [];
  for (const line of raw.split("\n")) {
    const evt = parseJsonlLine(line);
    if (!evt) continue;

    if (evt.type === "item.completed") {
      const item = (evt as CodexItemEvent).item;
      if (item.type === "message") {
        const texts = (item.content ?? [])
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text!);
        if (texts.length > 0) {
          // Determine role from item metadata
          const role = (item as Record<string, unknown>).role === "user" ? "user" as const : "assistant" as const;
          messages.push({ role, text: texts.join("\n") });
        }
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const codexProvider: ChatProvider = {
  id: "codex",
  name: "Codex",

  async detect(): Promise<boolean> {
    return new Promise((res) => {
      execFile("codex", ["--version"], (err) => res(!err));
    });
  },

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const { prompt, workspace, signal } = params;

    // Prepend agent instructions as context if configured
    const extra = readAgentInstructions(workspace);
    const fullPrompt = extra ? `[System context]\n${extra}\n\n[User request]\n${prompt}` : prompt;

    // Spawn codex in non-interactive JSONL mode
    const args = ["exec", "--json", fullPrompt];

    const child = spawn("codex", args, {
      cwd: workspace.sourceDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    if (signal) {
      signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }

    // Emit a synthetic init event (codex exec doesn't always emit thread.started)
    let initSent = false;

    let buffer = "";
    const decoder = new TextDecoder();

    const stdout = child.stdout!;

    // Wrap the readable stream into an async iterable of ChatEvents
    const eventIterator = async function* (): AsyncIterable<ChatEvent> {
      for await (const chunk of stdout) {
        buffer += decoder.decode(chunk as Buffer, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          const evt = parseJsonlLine(line);
          if (!evt) continue;

          const chatEvents = mapCodexEvent(evt);
          for (const ce of chatEvents) {
            if (ce.kind === "init") initSent = true;
            yield ce;
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const evt = parseJsonlLine(buffer);
        if (evt) {
          for (const ce of mapCodexEvent(evt)) yield ce;
        }
      }
    };

    if (!initSent) {
      yield { kind: "init", sessionId: `codex-${Date.now()}` };
    }

    yield* eventIterator();

    // Wait for process exit
    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        if (code && code !== 0) {
          // Don't reject — we already streamed error events if any
        }
        resolve();
      });
      child.on("error", reject);
    });
  },

  readHistory: readCodexSessionMessages,
};
