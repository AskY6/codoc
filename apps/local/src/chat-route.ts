// chat-route — SSE endpoint that proxies user messages to Claude Code via the Agent SDK.
//
// POST /api/chat  { prompt, sessionId?, activeCodoc? }
//   → text/event-stream of JSON-encoded SDK messages

import { Hono } from "hono";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Workspace } from "./workspace.js";
import { CodocPath as mkCodocPath } from "@cobook/core";
import { createMcpServer } from "./mcp-server.js";

/** Thin envelope sent to the browser over SSE. */
export type ChatEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; name: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result?: string; costUsd?: number };

export function createChatRoutes(
  state: { workspace: Workspace | null },
): Hono {
  const app = new Hono();

  app.post("/chat", async (c) => {
    if (!state.workspace) {
      return c.json({ error: "no workspace open" }, 503);
    }

    const sourceDir = state.workspace.sourceDir;

    const body = await c.req.json<{
      prompt: string;
      sessionId?: string;
      mentions?: string[];
    }>();

    const { prompt, sessionId } = body;
    // Normalize .mdx → .codoc so the LLM uses the correct path with MCP tools
    const mentions = (body.mentions ?? []).map((m) =>
      m.replace(/\.mdx$/, ".codoc"),
    );
    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    // @mention pattern: attach mentioned codoc content to the user message,
    // like Claude Code's @file — content travels with the message, not system prompt.
    const augmentedPrompt =
      mentions.length > 0
        ? buildMentionsPrompt(mentions, state.workspace!, prompt)
        : prompt;

    const systemPrompt = [
      "You are operating a codoc knowledge base via MCP tools.",
      "Available tools: list_codocs, read_codoc, write_codoc, search_codocs, update_data_field, append_content, create_from_template, dag_status, diagnose_codoc.",
      "When the user @mentions a codoc, its content is attached to their message. Work with it directly — do NOT re-read it or list all codocs.",
    ].join("\n");

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ChatEvent) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        };

        try {
          // Fresh MCP server per query — each SDK session needs its own instance.
          const chatMcp = state.workspace ? createMcpServer(state.workspace) : null;

          const q = query({
            prompt: augmentedPrompt,
            options: {
              systemPrompt,
              cwd: sourceDir,
              pathToClaudeCodeExecutable: "claude",
              ...(sessionId ? { resume: sessionId } : {}),
              maxTurns: 20,
              permissionMode: "acceptEdits",
              allowedTools: ["mcp__codoc__*"],
              tools: [], // disable built-in tools — only MCP
              ...(chatMcp
                ? {
                    mcpServers: {
                      codoc: {
                        type: "sdk" as const,
                        name: "codoc",
                        instance: chatMcp,
                      },
                    },
                  }
                : {}),
            },
          });

          for await (const msg of q) {
            for (const event of toEvents(msg)) {
              send(event);
            }
          }
        } catch (err) {
          send({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// @mentions — attach mentioned codocs to the user message (like Claude Code's @file)
// ---------------------------------------------------------------------------

function buildMentionsPrompt(
  mentions: string[],
  ws: Workspace,
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
// Map SDK messages to thin ChatEvent envelopes the UI cares about.
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
