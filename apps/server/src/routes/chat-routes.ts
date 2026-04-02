import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatService, WorkspaceService } from "@cobook/service";
import type { Agent, AgentMessage } from "@cobook/agent";

export function chatRoutes(
  chatService: ChatService,
  workspaceService: WorkspaceService,
  agent: Agent,
) {
  const app = new Hono();

  // POST /api/chat/thread — create a new thread
  app.post("/thread", async (c) => {
    const body = await c.req.json<{ workspaceId: string; title?: string }>();
    if (!body.workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }
    try {
      const thread = await chatService.createThread(body.workspaceId, body.title);
      return c.json(thread);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/thread/:id — get thread with messages
  app.get("/thread/:id", async (c) => {
    try {
      const result = await chatService.getThread(c.req.param("id"));
      if (!result) {
        return c.json({ error: "Thread not found" }, 404);
      }
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/threads — list threads for a workspace
  app.get("/threads", async (c) => {
    const wsId = c.req.query("workspaceId");
    if (!wsId) {
      return c.json({ error: "workspaceId query param is required" }, 400);
    }
    try {
      const threads = await chatService.listThreads(wsId);
      return c.json(threads);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /api/chat/thread/:id/message — send message, stream response via SSE
  app.post("/thread/:id/message", async (c) => {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ content: string; workspaceId: string }>();
    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }
    if (!body.workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }

    // Persist user message
    await chatService.addMessage(threadId, { role: "user", content: body.content });

    // Load history
    const history = await chatService.getMessages(threadId);
    const agentMessages: AgentMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    return streamSSE(c, async (stream) => {
      let fullText = "";

      try {
        for await (const event of agent.run(agentMessages, {
          workspaceId: body.workspaceId,
          service: workspaceService,
        })) {
          switch (event.kind) {
            case "text-delta":
              fullText += event.text;
              await stream.writeSSE({ event: "text-delta", data: JSON.stringify({ text: event.text }) });
              break;
            case "tool-use":
              await stream.writeSSE({ event: "tool-use", data: JSON.stringify({ toolName: event.toolName, input: event.input }) });
              break;
            case "tool-result":
              await stream.writeSSE({ event: "tool-result", data: JSON.stringify({ toolName: event.toolName, output: event.output }) });
              break;
            case "done":
              // Persist assistant message
              await chatService.addMessage(threadId, { role: "assistant", content: event.fullText });
              await stream.writeSSE({ event: "done", data: JSON.stringify({ fullText: event.fullText }) });
              break;
            case "error":
              await stream.writeSSE({ event: "error", data: JSON.stringify({ message: event.message }) });
              break;
          }
        }
      } catch (err) {
        // If we accumulated some text before the error, persist it
        if (fullText) {
          await chatService.addMessage(threadId, { role: "assistant", content: fullText });
        }
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: String(err) }) });
      }
    });
  });

  return app;
}
