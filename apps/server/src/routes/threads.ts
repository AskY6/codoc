// /api/threads — thread-scoped actions that don't fit under the
// workspace path. Listing + creating threads live on
// /api/workspaces/:id/threads (see ./workspaces.ts); this router owns
// the detail page bundle, delete, user-message append, agent turn
// (SSE streaming), and stream reconnect.

import type { AgentId, CodocId, ThreadId } from "@cobook/core";
import { createAnthropicLlmClient, type LlmClient } from "@cobook/chat";
import type { ServiceCtx } from "@cobook/service";
import {
  appendUserMessage,
  deleteThread,
  getThread,
  runAgentTurn,
  setThreadAgents,
  setThreadCodocs,
  updateThread,
} from "@cobook/service";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { respondError } from "../http/error.js";
import {
  closeActiveStream,
  createActiveStream,
  emitToStream,
  getActiveStream,
  hasActiveStream,
  resolveConfirmation,
  type SSEEvent,
} from "../streaming.js";

interface AppendMessageBody {
  readonly content?: unknown;
}

interface SetThreadAgentsBody {
  readonly agentIds?: unknown;
}

interface SetThreadCodocsBody {
  readonly codocIds?: unknown;
}

interface RunAgentTurnBody {
  readonly content?: unknown;
}

// ---- Auto-title generation ------------------------------------------------

async function generateTitle(
  llm: LlmClient,
  model: string,
  userMsg: string,
  assistantMsg: string,
): Promise<string> {
  const res = await llm.createMessage({
    model,
    maxTokens: 40,
    system: "",
    messages: [
      {
        role: "user",
        content: `Generate a very short title (max 6 words, no quotes) for this conversation:\n\nUser: ${userMsg}\n\nAssistant: ${assistantMsg.slice(0, 300)}`,
      },
    ],
  });
  const block = res.content[0];
  if (block?.type === "text") return block.text.trim();
  return "";
}

// ---- Route factory --------------------------------------------------------

export function threadRoutes(baseCtx: ServiceCtx) {
  const app = new Hono();

  // GET /api/threads/:id — page bundle: { thread, messages }
  app.get("/:id", async (c) => {
    const id = c.req.param("id") as ThreadId;
    const result = await getThread(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value);
  });

  // DELETE /api/threads/:id
  app.delete("/:id", async (c) => {
    const id = c.req.param("id") as ThreadId;
    const result = await deleteThread(baseCtx, id);
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.body(null, 204);
  });

  // POST /api/threads/:id/messages — { content }
  //
  // Direct user-message append (no agent turn). The primary send path
  // is POST /:id/turn which runs the agent graph; this endpoint
  // remains for appending user messages without triggering agents.
  app.post("/:id/messages", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: AppendMessageBody;
    try {
      body = (await c.req.json()) as AppendMessageBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.content !== "string" || body.content.trim() === "") {
      return c.json(
        { error: { kind: "bad-request", reason: "content is required" } },
        400,
      );
    }

    const result = await appendUserMessage(baseCtx, {
      threadId,
      content: body.content,
    });
    if (!result.ok) {
      return respondError(c, result.error);
    }
    return c.json(result.value, 201);
  });

  // PUT /api/threads/:id/agents — { agentIds: string[] }
  app.put("/:id/agents", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: SetThreadAgentsBody;
    try {
      body = (await c.req.json()) as SetThreadAgentsBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (
      !Array.isArray(body.agentIds) ||
      !body.agentIds.every((v: unknown) => typeof v === "string")
    ) {
      return c.json(
        { error: { kind: "bad-request", reason: "agentIds must be an array of strings" } },
        400,
      );
    }

    const result = await setThreadAgents(baseCtx, {
      threadId,
      agentIds: body.agentIds as AgentId[],
    });

    if (!result.ok) {
      const e = result.error;
      if (e.kind === "tx-aborted") {
        return c.json({ error: { kind: "storage-unavailable" } }, 503);
      }
      return respondError(c, e);
    }
    return c.json({ agentIds: result.value });
  });

  // PUT /api/threads/:id/codocs — { codocIds: string[] }
  app.put("/:id/codocs", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: SetThreadCodocsBody;
    try {
      body = (await c.req.json()) as SetThreadCodocsBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (
      !Array.isArray(body.codocIds) ||
      !body.codocIds.every((v: unknown) => typeof v === "string")
    ) {
      return c.json(
        {
          error: { kind: "bad-request", reason: "codocIds must be an array of strings" },
        },
        400,
      );
    }

    const result = await setThreadCodocs(baseCtx, {
      threadId,
      codocIds: body.codocIds as CodocId[],
    });

    if (!result.ok) {
      const e = result.error;
      if (e.kind === "tx-aborted") {
        return c.json({ error: { kind: "storage-unavailable" } }, 503);
      }
      return respondError(c, e);
    }
    return c.json({ codocIds: result.value });
  });

  // GET /api/threads/:id/stream — reconnect to an in-progress SSE response
  app.get("/:id/stream", async (c) => {
    const threadId = c.req.param("id");
    const active = getActiveStream(threadId);
    if (!active || active.done) {
      return new Response(null, { status: 204 });
    }

    return streamSSE(c, async (stream) => {
      // 1. Replay buffered events.
      for (const evt of active.events) {
        await stream.writeSSE(evt);
      }

      if (active.done) return;

      // 2. Listen for new events.
      await new Promise<void>((resolve) => {
        const listener = (evt: SSEEvent) => {
          stream.writeSSE(evt).catch(() => {
            active.listeners.delete(listener);
            resolve();
          });
          if (evt.event === "done" || evt.event === "error") {
            setTimeout(() => {
              active.listeners.delete(listener);
              resolve();
            }, 3000);
          }
        };
        active.listeners.add(listener);

        c.req.raw.signal.addEventListener("abort", () => {
          active.listeners.delete(listener);
          resolve();
        });
      });
    });
  });

  // POST /api/threads/:id/turn — { content }
  //
  // SSE streaming agent turn (5b). Runs the router → specialist graph
  // and streams ChatEvents as SSE. After the graph completes, persists
  // assistant messages and optionally auto-generates a title.
  app.post("/:id/turn", async (c) => {
    const threadId = c.req.param("id") as ThreadId;
    let body: RunAgentTurnBody;
    try {
      body = (await c.req.json()) as RunAgentTurnBody;
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.content !== "string" || body.content.trim() === "") {
      return c.json(
        { error: { kind: "bad-request", reason: "content is required" } },
        400,
      );
    }

    // Reject concurrent streams on the same thread.
    if (hasActiveStream(threadId)) {
      return c.json(
        { error: { kind: "conflict", reason: "Thread has an active response in progress" } },
        409,
      );
    }

    // Check if this thread needs an auto-generated title.
    const threadResult = await getThread(baseCtx, threadId);
    if (!threadResult.ok) {
      return respondError(c, threadResult.error);
    }
    const needsTitle = threadResult.value.thread.thread.title == null;
    const threadRev = threadResult.value.thread.rev;

    const active = createActiveStream(threadId);

    return streamSSE(c, async (stream) => {
      function emit(evt: SSEEvent) {
        emitToStream(active, evt);
        return stream.writeSSE(evt);
      }

      let titlePromise: Promise<void> | undefined;

      // Confirmation gate: emits SSE event and blocks until the client
      // responds via POST /:id/confirm.
      let confirmRequestCounter = 0;
      async function confirmTool(
        tool: string,
        toolInput: Readonly<Record<string, unknown>>,
      ): Promise<boolean> {
        const requestId = `${threadId}-${++confirmRequestCounter}`;
        return new Promise<boolean>((resolve) => {
          // Register the pending confirmation.
          active.pendingConfirmation = { requestId, resolve };

          // Timeout: auto-deny after 2 minutes.
          const timeout = setTimeout(() => {
            if (active.pendingConfirmation?.requestId === requestId) {
              active.pendingConfirmation.resolve(false);
              active.pendingConfirmation = null;
            }
          }, 120_000);

          // Wrap the original resolve to clear the timeout.
          const originalResolve = resolve;
          active.pendingConfirmation = {
            requestId,
            resolve: (approved: boolean) => {
              clearTimeout(timeout);
              originalResolve(approved);
            },
          };
        });
      }

      try {
        const result = await runAgentTurn(baseCtx, {
          threadId,
          content: body.content as string,
          signal: c.req.raw.signal,
          confirmTool,
          onEvent: (event) => {
            // Map ChatEvent to SSE events. Fire-and-forget write;
            // errors are swallowed — the client may have disconnected.
            const sseEvent = chatEventToSSE(event);
            if (sseEvent) {
              emit(sseEvent).catch(() => {});
            }
          },
        });

        if (!result.ok) {
          await emit({
            event: "error",
            data: JSON.stringify({ message: "message" in result.error ? result.error.message : result.error.kind }),
          });
        } else {
          // Emit done with all assistant messages.
          await emit({
            event: "done",
            data: JSON.stringify({
              userMessage: result.value.userMessage,
              assistantMessages: result.value.assistantMessages,
            }),
          });

          // Auto-title on first exchange.
          if (needsTitle && result.value.assistantMessages.length > 0) {
            const assistantText = result.value.assistantMessages
              .map((m) => m.message.kind === "assistant" ? m.message.content : "")
              .join("\n");

            titlePromise = (async () => {
              try {
                const llm = createAnthropicLlmClient({
                  apiKey: baseCtx.llmConfig.apiKey,
                  baseURL: baseCtx.llmConfig.baseURL,
                });
                const model = baseCtx.llmConfig.routerModel ?? "claude-haiku-4-5-20251001";
                const title = await generateTitle(
                  llm,
                  model,
                  body.content as string,
                  assistantText,
                );
                if (title) {
                  const updateResult = await updateThread(baseCtx, {
                    id: threadId,
                    title,
                    expectedRev: threadRev,
                  });
                  if (updateResult.ok) {
                    await emit({
                      event: "title-update",
                      data: JSON.stringify({ title }),
                    });
                  }
                }
              } catch {
                // Fire-and-forget — title generation failure is non-critical.
              }
            })();
          }
        }
      } catch (error) {
        await emit({
          event: "error",
          data: JSON.stringify({ message: String(error) }),
        });
      }

      // Wait for title generation before closing the stream.
      if (titlePromise) await titlePromise;
      closeActiveStream(threadId, active);
    });
  });

  // POST /api/threads/:id/confirm — { requestId, approved }
  //
  // Resolves a pending tool confirmation. The agent turn is paused
  // waiting for this response.
  app.post("/:id/confirm", async (c) => {
    const threadId = c.req.param("id");
    let body: { requestId?: unknown; approved?: unknown };
    try {
      body = (await c.req.json()) as { requestId?: unknown; approved?: unknown };
    } catch {
      return c.json(
        { error: { kind: "bad-request", reason: "invalid JSON body" } },
        400,
      );
    }

    if (typeof body.requestId !== "string" || typeof body.approved !== "boolean") {
      return c.json(
        { error: { kind: "bad-request", reason: "requestId (string) and approved (boolean) are required" } },
        400,
      );
    }

    const active = getActiveStream(threadId);
    if (!active || active.done) {
      return c.json(
        { error: { kind: "not-found", reason: "No active stream for this thread" } },
        404,
      );
    }

    const resolved = resolveConfirmation(active, body.requestId, body.approved);
    if (!resolved) {
      return c.json(
        { error: { kind: "not-found", reason: "No pending confirmation with this requestId" } },
        404,
      );
    }

    return c.json({ ok: true });
  });

  return app;
}

// ---- Helpers --------------------------------------------------------------

function chatEventToSSE(
  event: import("@cobook/chat").ChatEvent,
): SSEEvent | null {
  switch (event.kind) {
    case "token":
      return {
        event: "token",
        data: JSON.stringify({ delta: event.delta, nodeId: event.nodeId }),
      };
    case "toolCall":
      return {
        event: "toolCall",
        data: JSON.stringify({
          tool: event.tool,
          input: event.input,
          nodeId: event.nodeId,
        }),
      };
    case "toolResult":
      return {
        event: "toolResult",
        data: JSON.stringify({
          tool: event.tool,
          output: event.output,
          nodeId: event.nodeId,
        }),
      };
    case "confirmationRequest":
      return {
        event: "confirmationRequest",
        data: JSON.stringify({
          requestId: event.requestId,
          tool: event.tool,
          input: event.input,
          nodeId: event.nodeId,
        }),
      };
    case "agentHandoff":
      return {
        event: "agentHandoff",
        data: JSON.stringify({ from: event.from, to: event.to }),
      };
    case "done":
      // The "done" ChatEvent is per-agent-node; the SSE "done" is
      // emitted separately with full persisted messages. Skip here.
      return null;
  }
}
