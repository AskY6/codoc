import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatService, WorkspaceService, AgentSessionRepository } from "@cobook/service";
import type { Agent, AgentMessage } from "@cobook/agent";

export type AgentRegistry = Map<string, Agent>;

// ---------------------------------------------------------------------------
// Parse @agent-id at the start of a message.
// Returns { targetAgentId, content } where content has the @mention stripped.
// ---------------------------------------------------------------------------
function parseAtMention(raw: string): { targetAgentId: string | undefined; content: string } {
  const match = raw.match(/^@([\w-]+)\s+/);
  if (match) {
    return { targetAgentId: match[1], content: raw.slice(match[0].length) };
  }
  return { targetAgentId: undefined, content: raw };
}

// ---------------------------------------------------------------------------
// Resolve which agent should handle a message.
// This is the router extension point — currently falls back to default agent.
// Future: replace with router agent logic that analyses chatContext.
// ---------------------------------------------------------------------------
function resolveAgent(
  agents: AgentRegistry,
  defaultAgentId: string,
  targetAgentId: string | undefined,
): { agentId: string; agent: Agent } {
  if (targetAgentId) {
    const agent = agents.get(targetAgentId);
    if (agent) return { agentId: targetAgentId, agent };
  }
  return { agentId: defaultAgentId, agent: agents.get(defaultAgentId)! };
}

export function chatRoutes(
  chatService: ChatService,
  workspaceService: WorkspaceService,
  agents: AgentRegistry,
  sessionRepo: AgentSessionRepository,
) {
  const app = new Hono();

  const defaultAgentId = agents.keys().next().value!;

  // POST /api/chat/thread — create a new thread
  app.post("/thread", async (c) => {
    const body = await c.req.json<{ workspaceId: string; title?: string }>();
    if (!body.workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }
    try {
      const thread = await chatService.createThread(body.workspaceId, body.title);
      // Auto-register all available agents as thread participants
      const allAgentIds = [...agents.keys()];
      await chatService.setThreadAgents(thread.id, allAgentIds);
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

  // PATCH /api/chat/thread/:id — update thread (title)
  app.patch("/thread/:id", async (c) => {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ title?: string }>();
    try {
      const thread = await chatService.updateThread(threadId, body);
      return c.json(thread);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // PUT /api/chat/thread/:id/codocs — set codoc subset for thread
  app.put("/thread/:id/codocs", async (c) => {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ codocIds: string[] }>();
    if (!Array.isArray(body.codocIds)) {
      return c.json({ error: "codocIds array is required" }, 400);
    }
    try {
      await chatService.setThreadCodocs(threadId, body.codocIds);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/thread/:id/codocs — get codoc subset for thread
  app.get("/thread/:id/codocs", async (c) => {
    const threadId = c.req.param("id");
    try {
      const codocs = await chatService.getThreadCodocs(threadId);
      return c.json(codocs);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // PUT /api/chat/thread/:id/agents — set agent participants for thread
  app.put("/thread/:id/agents", async (c) => {
    const threadId = c.req.param("id");
    const body = await c.req.json<{ agentIds: string[] }>();
    if (!Array.isArray(body.agentIds)) {
      return c.json({ error: "agentIds array is required" }, 400);
    }
    try {
      await chatService.setThreadAgents(threadId, body.agentIds);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/thread/:id/agents — get agent participants for thread
  app.get("/thread/:id/agents", async (c) => {
    const threadId = c.req.param("id");
    try {
      const threadAgents = await chatService.getThreadAgents(threadId);
      return c.json(threadAgents);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/agents — list available agents
  app.get("/agents", (c) => {
    const list = [...agents.keys()].map((id) => ({ id }));
    return c.json(list);
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

    // Parse @mention from message start
    const { targetAgentId, content } = parseAtMention(body.content);

    // Persist user message (with original content including @mention)
    await chatService.addMessage(threadId, { role: "user", content: body.content });

    // Resolve which agent handles this message
    const { agentId, agent } = resolveAgent(agents, defaultAgentId, targetAgentId);

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
          sessionRepo,
        })) {
          switch (event.kind) {
            case "text-delta":
              fullText += event.text;
              await stream.writeSSE({ event: "text-delta", data: JSON.stringify({ text: event.text, agentId }) });
              break;
            case "tool-use":
              await stream.writeSSE({ event: "tool-use", data: JSON.stringify({ toolName: event.toolName, input: event.input, agentId }) });
              break;
            case "tool-result":
              await stream.writeSSE({ event: "tool-result", data: JSON.stringify({ toolName: event.toolName, output: event.output, agentId }) });
              break;
            case "done":
              // Persist assistant message with agent attribution
              await chatService.addMessage(threadId, { role: "assistant", content: event.fullText, agentId });
              await stream.writeSSE({ event: "done", data: JSON.stringify({ fullText: event.fullText, agentId }) });
              break;
            case "error":
              await stream.writeSSE({ event: "error", data: JSON.stringify({ message: event.message, agentId }) });
              break;
          }
        }
      } catch (err) {
        if (fullText) {
          await chatService.addMessage(threadId, { role: "assistant", content: fullText, agentId });
        }
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: String(err), agentId }) });
      }
    });
  });

  return app;
}
