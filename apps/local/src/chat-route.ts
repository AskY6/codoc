// chat-route — SSE endpoint that proxies user messages to Claude Code via the Agent SDK.
//
// POST /api/chat  { prompt, sessionId?, activeCodoc? }
//   → text/event-stream of JSON-encoded SDK messages

import { Hono } from "hono";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Workspace } from "./workspace.js";

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
  port: number,
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
      activeCodoc?: string;
    }>();

    const { prompt, sessionId, activeCodoc } = body;
    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    const systemPrompt = [
      "You are operating a codoc knowledge base via MCP tools.",
      "Use the codoc MCP tools (list_codocs, read_codoc, write_codoc, search_codocs, update_data_field, append_content, create_from_template, dag_status) to fulfill requests.",
      activeCodoc
        ? `The user is currently viewing: ${activeCodoc}`
        : "No specific codoc is in focus.",
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
          const q = query({
            prompt,
            options: {
              systemPrompt,
              cwd: sourceDir,
              ...(sessionId ? { resume: sessionId } : {}),
              maxTurns: 20,
              permissionMode: "acceptEdits",
              allowedTools: ["mcp__codoc__*"],
              tools: [], // disable built-in tools — only MCP
              mcpServers: {
                codoc: {
                  type: "http",
                  url: `http://localhost:${port}/mcp`,
                },
              },
            },
          });

          for await (const msg of q) {
            const event = toEvent(msg);
            if (event) send(event);
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
// Map SDK messages to thin ChatEvent envelopes the UI cares about.
// ---------------------------------------------------------------------------

function toEvent(msg: SDKMessage): ChatEvent | null {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        return { kind: "init", sessionId: msg.session_id };
      }
      return null;

    case "assistant": {
      // Extract text and tool_use blocks from the Anthropic message.
      const blocks = msg.message.content;
      for (const block of blocks) {
        if (block.type === "tool_use") {
          return {
            kind: "tool_use",
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        }
        if (block.type === "text" && block.text) {
          return { kind: "text", text: block.text };
        }
      }
      return null;
    }

    case "result": {
      const event: ChatEvent = { kind: "done" };
      if (msg.subtype === "success") {
        event.result = msg.result;
        event.costUsd = msg.total_cost_usd;
      }
      return event;
    }

    default:
      return null;
  }
}
