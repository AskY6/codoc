// providers/claude-code — Claude Code adapter via @anthropic-ai/claude-agent-sdk.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { CodocPath as mkCodocPath } from "@cobook/core";
import { createMcpServer } from "../server/mcp.js";
import type { ChatProvider, ChatParams, ChatEvent, SessionMessage } from "./types.js";
import { readAgentInstructions } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers — @mention augmentation
// ---------------------------------------------------------------------------

function buildMentionsPrompt(
  mentions: string[],
  ws: ChatParams["workspace"],
  userPrompt: string,
): string {
  const blocks: string[] = [];
  for (const path of mentions) {
    const codoc = ws.codocs.get(mkCodocPath(path));
    if (codoc) {
      blocks.push(
        `@${path}:\n<codoc path="${path}">\n${codoc.content}</codoc>`,
      );
    }
  }
  if (blocks.length === 0) return userPrompt;
  return blocks.join("\n\n") + "\n\n" + userPrompt;
}

// ---------------------------------------------------------------------------
// Helpers — multimodal prompt
// ---------------------------------------------------------------------------

interface ImagePayload { dataUrl: string; name: string }

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
        data: string;
      };
    };

function buildMultimodalPrompt(
  text: string,
  images: ImagePayload[],
): AsyncIterable<SDKUserMessage> {
  const contentBlocks: ContentBlock[] = [];

  for (const img of images) {
    const match = img.dataUrl.match(
      /^data:(image\/[a-z+]+);base64,(.+)$/i,
    );
    if (match) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match[1] as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: match[2]!,
        },
      });
    }
  }

  contentBlocks.push({ type: "text", text });

  const msg: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: contentBlocks as SDKUserMessage["message"]["content"] },
    parent_tool_use_id: null,
  };

  return (async function* () {
    yield msg;
  })();
}

// ---------------------------------------------------------------------------
// SDK message → ChatEvent mapping
// ---------------------------------------------------------------------------

function toEvents(msg: SDKMessage): ChatEvent[] {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        return [{ kind: "init", sessionId: msg.session_id }];
      }
      return [];

    case "assistant": {
      const events: ChatEvent[] = [];
      const blocks = msg.message.content;
      for (const block of blocks) {
        if (block.type === "tool_use") {
          events.push({
            kind: "tool_use",
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
        if (block.type === "text" && block.text) {
          events.push({ kind: "text", text: block.text });
        }
      }
      return events;
    }

    case "result": {
      const event: ChatEvent = { kind: "done" };
      if (msg.subtype === "success") {
        event.result = msg.result;
        event.costUsd = msg.total_cost_usd;
      }
      return [event];
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Session history reader
// ---------------------------------------------------------------------------

function claudeProjectDir(cwd: string): string {
  const encoded = resolve(cwd).replace(/[/.]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

async function readClaudeSessionMessages(
  sessionId: string,
  cwd: string,
): Promise<SessionMessage[]> {
  const sessionFile = join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf-8");
  } catch {
    return [];
  }

  const messages: SessionMessage[] = [];
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
      if (blocks.some((b) => b.type === "tool_result")) continue;
      flushPending();
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text as string)
        .join("\n");
      if (text) {
        messages.push({ role: "user", text });
      }
    } else {
      if (!pending) pending = { text: "", toolCalls: [] };
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          if (pending.text) pending.text += "\n";
          pending.text += (block.text as string).replace(/^\n+/, "");
        } else if (block.type === "tool_use" && block.name) {
          pending.toolCalls.push({ name: block.name as string, status: "done" });
        }
      }
    }
  }

  flushPending();
  return messages;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const claudeCodeProvider: ChatProvider = {
  id: "claude-code",
  name: "Claude Code",

  async detect(): Promise<boolean> {
    return new Promise((res) => {
      execFile("claude", ["--version"], (err) => res(!err));
    });
  },

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const { prompt, sessionId, workspace, mentions = [], images = [], signal } = params;

    const augmentedPrompt =
      mentions.length > 0
        ? buildMentionsPrompt(mentions, workspace, prompt)
        : prompt;

    const hasImages = images.length > 0;

    const baseParts = [
      "You are operating a codoc knowledge base via MCP tools.",
      "Available tools: list_codocs, read_codoc, write_codoc, search_codocs, update_data_field, append_content, create_from_template, dag_status, diagnose_codoc, fetch_url.",
      "When the user @mentions a codoc, its content is attached to their message. Work with it directly — do NOT re-read it or list all codocs.",
    ];
    const extra = readAgentInstructions(workspace);
    if (extra) baseParts.push("", extra);
    const systemPrompt = baseParts.join("\n");

    const chatMcp = createMcpServer(workspace);

    const sdkPrompt = hasImages
      ? buildMultimodalPrompt(augmentedPrompt, images)
      : augmentedPrompt;

    const q = query({
      prompt: sdkPrompt,
      options: {
        systemPrompt,
        cwd: workspace.sourceDir,
        pathToClaudeCodeExecutable: "claude",
        ...(sessionId ? { resume: sessionId } : {}),
        maxTurns: 50,
        permissionMode: "acceptEdits",
        allowedTools: ["mcp__codoc__*"],
        tools: [],
        mcpServers: {
          codoc: {
            type: "sdk" as const,
            name: "codoc",
            instance: chatMcp,
          },
        },
      },
    });

    // Wire abort signal
    if (signal) {
      signal.addEventListener("abort", () => q.return(undefined), { once: true });
    }

    for await (const msg of q) {
      for (const event of toEvents(msg)) {
        yield event;
      }
    }
  },

  readHistory: readClaudeSessionMessages,
};
