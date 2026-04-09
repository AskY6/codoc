import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatService, WorkspaceService, AgentSessionRepository } from "@cobook/service";
import type { Agent, AgentMessage } from "@cobook/agent";

export type AgentRegistry = Map<string, Agent>;

// ---------------------------------------------------------------------------
// Active stream tracking — allows reconnecting to an in-progress response
// ---------------------------------------------------------------------------

interface SSEEvent {
  event: string;
  data: string; // already JSON-stringified
}

interface ActiveStream {
  events: SSEEvent[];
  listeners: Set<(evt: SSEEvent) => void>;
  done: boolean;
}

const activeStreams = new Map<string, ActiveStream>();

function createActiveStream(threadId: string): ActiveStream {
  const stream: ActiveStream = { events: [], listeners: new Set(), done: false };
  activeStreams.set(threadId, stream);
  return stream;
}

function emitToStream(stream: ActiveStream, evt: SSEEvent) {
  stream.events.push(evt);
  for (const listener of stream.listeners) listener(evt);
}

function closeActiveStream(threadId: string, stream: ActiveStream) {
  stream.done = true;
  stream.listeners.clear();
  activeStreams.delete(threadId);
}

// ---------------------------------------------------------------------------
// Raw action context sent by the UI. Describes where a message originated
// (e.g. which codoc's view the user clicked on) so the enhancer can turn it
// into richer routing signals.
// ---------------------------------------------------------------------------
interface ViewActionContext {
  sourceCodocPath?: string;
}

// ---------------------------------------------------------------------------
// Structured input to the router. `content` is the user's message; optional
// `contextSummary` is a short natural-language description of the trigger
// context, produced by enhanceIntent().
// ---------------------------------------------------------------------------
interface RoutingIntent {
  content: string;
  contextSummary?: string;
}

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
// enhanceIntent — bridge between chat service and router.
//
// Takes raw message content plus optional action context, resolves context
// signals (e.g. looks up the source codoc's meta), and produces a
// RoutingIntent the router can reason over. Keeps routing logic decoupled
// from both UI and the router itself.
// ---------------------------------------------------------------------------
async function enhanceIntent(
  content: string,
  context: ViewActionContext | undefined,
  workspaceService: WorkspaceService,
  workspaceId: string,
): Promise<RoutingIntent> {
  if (!context?.sourceCodocPath) {
    return { content };
  }

  const signals: string[] = [`source codoc: ${context.sourceCodocPath}`];
  try {
    const codoc = await workspaceService.getCodoc(workspaceId, context.sourceCodocPath);
    const meta = codoc?.ast?.meta as Record<string, unknown> | undefined;
    if (meta) {
      if (typeof meta["title"] === "string") signals.push(`codoc title: ${meta["title"]}`);
      if (typeof meta["description"] === "string") signals.push(`codoc description: ${meta["description"]}`);
      const tags = meta["tags"];
      if (Array.isArray(tags) && tags.length > 0) {
        signals.push(`codoc tags: ${tags.map(String).join(", ")}`);
      }
    }
  } catch {
    // Missing codoc or lookup failure — degrade gracefully to path-only signal
  }

  return { content, contextSummary: signals.join("; ") };
}

// ---------------------------------------------------------------------------
// Route a message to the best-matching agent from the thread's agent list.
// Priority: explicit @mention > single-agent shortcut > LLM classification.
// ---------------------------------------------------------------------------

interface RouteResult {
  agentId: string;
  agent: Agent;
  fallback: boolean;
  invalidMention?: string; // set when @mention targets a non-existent agent
}

async function routeToAgent(
  client: Anthropic,
  model: string,
  agents: AgentRegistry,
  threadAgentIds: string[],
  targetAgentId: string | undefined,
  intent: RoutingIntent,
): Promise<RouteResult> {
  let invalidMention: string | undefined;

  // 1. Explicit @mention or targetAgentId — honour it if valid
  if (targetAgentId) {
    const agent = agents.get(targetAgentId);
    if (agent) return { agentId: targetAgentId, agent, fallback: false };
    // Invalid @mention — note it but continue with normal routing
    invalidMention = targetAgentId;
  }

  // Scope to thread agents (fall back to all agents if thread has none)
  const scopedIds = threadAgentIds.length > 0
    ? threadAgentIds.filter((id) => agents.has(id))
    : [...agents.keys()];

  if (scopedIds.length === 0) {
    throw new Error("No agents available for this thread");
  }

  const base = invalidMention != null ? { invalidMention } : {};

  // 2. Single agent in scope — no routing needed
  if (scopedIds.length <= 1) {
    return { agentId: scopedIds[0]!, agent: agents.get(scopedIds[0]!)!, fallback: false, ...base };
  }

  // 3. LLM-based routing — ask haiku to pick the best agent
  try {
    const agentList = scopedIds.map((id) => {
      const a = agents.get(id)!;
      return `- ${id}: ${a.name} — ${a.description}`;
    }).join("\n");

    const contextBlock = intent.contextSummary
      ? `\n\nTrigger context (strong hint about intent):\n${intent.contextSummary}`
      : "";

    const res = await client.messages.create({
      model,
      max_tokens: 20,
      messages: [
        {
          role: "user",
          content: `Which agent should handle this user message? Reply with ONLY the agent id, nothing else. When trigger context is provided, weight it heavily — it usually points directly at the right agent.\n\nAgents:\n${agentList}\n\nUser message: ${intent.content.slice(0, 500)}${contextBlock}`,
        },
      ],
    });
    const block = res.content[0];
    const chosen = block?.type === "text" ? block.text.trim() : "";
    if (chosen && agents.has(chosen) && scopedIds.includes(chosen)) {
      return { agentId: chosen, agent: agents.get(chosen)!, fallback: false, ...base };
    }
  } catch {
    // Routing failure — fall through to default
  }

  // 4. Fallback — first thread agent
  const fallbackId = scopedIds[0]!;
  return { agentId: fallbackId, agent: agents.get(fallbackId)!, fallback: true, ...base };
}

// ---------------------------------------------------------------------------
// Auto-generate a short title from the first user+assistant exchange.
// Fire-and-forget — failures are silently ignored.
// ---------------------------------------------------------------------------

async function generateTitle(client: Anthropic, model: string, userMsg: string, assistantMsg: string): Promise<string> {
  const res = await client.messages.create({
    model,
    max_tokens: 40,
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

export interface LightLLMConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

export function chatRoutes(
  chatService: ChatService,
  workspaceService: WorkspaceService,
  agents: AgentRegistry,
  sessionRepo: AgentSessionRepository,
  llmConfig?: LightLLMConfig,
) {
  const app = new Hono();
  const llmClient = new Anthropic({
    ...(llmConfig?.baseURL && { baseURL: llmConfig.baseURL }),
    ...(llmConfig?.apiKey && { apiKey: llmConfig.apiKey }),
  });
  const lightModel = llmConfig?.model ?? "claude-haiku-4-5-20251001";


  // POST /api/chat/thread — create a new thread
  app.post("/thread", async (c) => {
    const body = await c.req.json<{
      workspaceId: string;
      title?: string;
      agentIds?: string[];
      codocIds?: string[];
    }>();
    if (!body.workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }
    try {
      const thread = await chatService.createThread(body.workspaceId, body.title);

      // Resolve agent set: explicit > workspace defaults > all agents
      let agentIds = body.agentIds;
      if (!agentIds) {
        const wsAgents = await chatService.getWorkspaceAgents(body.workspaceId);
        agentIds = wsAgents.length > 0
          ? wsAgents.map((wa) => wa.agentId)
          : [...agents.keys()];
      }
      await chatService.setThreadAgents(thread.id, agentIds);

      // Set initial codocs if provided
      if (body.codocIds && body.codocIds.length > 0) {
        await chatService.setThreadCodocs(thread.id, body.codocIds);
      }

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

  // DELETE /api/chat/thread/:id — delete a thread
  app.delete("/thread/:id", async (c) => {
    const threadId = c.req.param("id");
    try {
      await chatService.deleteThread(threadId);
      return c.json({ ok: true });
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

  // PUT /api/chat/workspace/:id/agents — set workspace default agents
  app.put("/workspace/:id/agents", async (c) => {
    const workspaceId = c.req.param("id");
    const body = await c.req.json<{ agentIds: string[] }>();
    if (!Array.isArray(body.agentIds)) {
      return c.json({ error: "agentIds array is required" }, 400);
    }
    try {
      await chatService.setWorkspaceAgents(workspaceId, body.agentIds);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/workspace/:id/agents — get workspace default agents
  app.get("/workspace/:id/agents", async (c) => {
    const workspaceId = c.req.param("id");
    try {
      const wsAgents = await chatService.getWorkspaceAgents(workspaceId);
      return c.json(wsAgents);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/chat/agents — list available agents
  app.get("/agents", (c) => {
    const list = [...agents.entries()].map(([id, agent]) => ({
      id,
      name: agent.name,
      description: agent.description,
    }));
    return c.json(list);
  });

  // GET /api/chat/thread/:id/stream — reconnect to an in-progress response
  app.get("/thread/:id/stream", async (c) => {
    const threadId = c.req.param("id");
    const active = activeStreams.get(threadId);
    if (!active || active.done) {
      return new Response(null, { status: 204 });
    }

    return streamSSE(c, async (stream) => {
      // 1. Replay buffered events
      for (const evt of active.events) {
        await stream.writeSSE(evt);
      }

      // If already done during replay, stop
      if (active.done) return;

      // 2. Listen for new events
      await new Promise<void>((resolve) => {
        const listener = (evt: SSEEvent) => {
          stream.writeSSE(evt).catch(() => {
            active.listeners.delete(listener);
            resolve();
          });
          if (evt.event === "done" || evt.event === "error") {
            // Allow a brief window for title-update before closing
            setTimeout(() => {
              active.listeners.delete(listener);
              resolve();
            }, 3000);
          }
        };
        active.listeners.add(listener);

        // Clean up if client disconnects
        c.req.raw.signal.addEventListener("abort", () => {
          active.listeners.delete(listener);
          resolve();
        });
      });
    });
  });

  // POST /api/chat/thread/:id/message — send message, stream response via SSE
  app.post("/thread/:id/message", async (c) => {
    const threadId = c.req.param("id");
    const body = await c.req.json<{
      content: string;
      workspaceId: string;
      targetAgentId?: string;
      context?: ViewActionContext;
    }>();
    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }
    if (!body.workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }

    // Reject concurrent streams on the same thread (before any side effects)
    const existing = activeStreams.get(threadId);
    if (existing && !existing.done) {
      return c.json({ error: "Thread has an active response in progress" }, 409);
    }

    // Resolve target agent: explicit field takes priority, then @mention parsing
    const parsed = parseAtMention(body.content);
    const effectiveTargetId = body.targetAgentId ?? parsed.targetAgentId;
    // Only strip @mention from saved content when it matches a registered agent
    const mentionIsValid = parsed.targetAgentId != null && agents.has(parsed.targetAgentId);
    const content = mentionIsValid ? parsed.content : body.content;

    // Persist user message with stripped content — @mention is routing-only metadata
    await chatService.addMessage(threadId, { role: "user", content });

    // Enhance the raw action into a structured routing intent (adds codoc
    // meta signals when the message originated from a view action).
    const intent = await enhanceIntent(parsed.content, body.context, workspaceService, body.workspaceId);

    // Query thread agents and route to the best-matching one
    const threadAgentRows = await chatService.getThreadAgents(threadId);
    const threadAgentIds = threadAgentRows.map((ta) => ta.agentId);
    const routeResult = await routeToAgent(llmClient, lightModel, agents, threadAgentIds, effectiveTargetId, intent);
    const { agentId, agent } = routeResult;

    // Check if this thread needs an auto-generated title
    const threadData = await chatService.getThread(threadId);
    const needsTitle = threadData != null && threadData.thread.title == null;

    // Load thread codocs for agent context
    const threadCodocRows = await chatService.getThreadCodocs(threadId);
    const threadCodocs = (await Promise.all(
      threadCodocRows.map((tc) => workspaceService.getCodocById(tc.codocId)),
    )).filter((c): c is NonNullable<typeof c> => c != null)
      .map((c) => ({ path: c.path, content: c.content }));

    // Load history
    const history = await chatService.getMessages(threadId);
    const agentMessages: AgentMessage[] = history.map((m) => {
      let msgContent = m.content;
      // Prefix assistant messages with agent attribution
      if (m.role === "assistant" && m.agentId) {
        msgContent = `[agent: ${m.agentId}]\n${msgContent}`;
      }
      // Append tool call summaries from metadata
      if (m.metadata?.toolCalls && m.metadata.toolCalls.length > 0) {
        const summary = m.metadata.toolCalls
          .map((t: { name: string; input: Record<string, unknown> }) => `- ${t.name}(${JSON.stringify(t.input)})`)
          .join("\n");
        msgContent += `\n\n[tools used:\n${summary}\n]`;
      }
      return { role: m.role as "user" | "assistant", content: msgContent };
    });

    const active = createActiveStream(threadId);

    return streamSSE(c, async (stream) => {
      let fullText = "";
      const toolCalls: { name: string; input: Record<string, unknown> }[] = [];
      let titlePromise: Promise<void> | undefined;

      function emit(evt: SSEEvent) {
        emitToStream(active, evt);
        return stream.writeSSE(evt);
      }

      try {
        // Emit routing feedback before agent starts
        if (routeResult.invalidMention) {
          await emit({ event: "status", data: JSON.stringify({ text: `Unknown agent @${routeResult.invalidMention}, routed to ${agentId}`, agentId }) });
        } else if (routeResult.fallback) {
          await emit({ event: "status", data: JSON.stringify({ text: `Routed to ${agentId} (fallback)`, agentId }) });
        }

        const agentCtx = {
          workspaceId: body.workspaceId,
          service: workspaceService,
          sessionRepo,
          ...(threadCodocs.length > 0 ? { threadCodocs } : {}),
        };
        for await (const event of agent.run(agentMessages, agentCtx)) {
          switch (event.kind) {
            case "text-delta":
              fullText += event.text;
              await emit({ event: "text-delta", data: JSON.stringify({ text: event.text, agentId }) });
              break;
            case "status":
              await emit({ event: "status", data: JSON.stringify({ text: event.text, agentId }) });
              break;
            case "tool-use":
              toolCalls.push({ name: event.toolName, input: event.input });
              await emit({ event: "tool-use", data: JSON.stringify({ toolName: event.toolName, input: event.input, agentId }) });
              break;
            case "tool-result":
              await emit({ event: "tool-result", data: JSON.stringify({ toolName: event.toolName, output: event.output, agentId }) });
              break;
            case "done":
              // Persist assistant message with agent attribution and tool call metadata
              await chatService.addMessage(threadId, {
                role: "assistant",
                content: event.fullText,
                agentId,
                ...(toolCalls.length > 0 ? { metadata: { toolCalls } } : {}),
              });
              await emit({ event: "done", data: JSON.stringify({ fullText: event.fullText, agentId }) });
              // Auto-generate title from first exchange
              if (needsTitle) {
                titlePromise = generateTitle(llmClient, lightModel, content, event.fullText)
                  .then(async (title) => {
                    if (title) {
                      await chatService.updateThread(threadId, { title });
                      await emit({ event: "title-update", data: JSON.stringify({ title }) });
                    }
                  })
                  .catch(() => {});
              }
              break;
            case "error":
              await emit({ event: "error", data: JSON.stringify({ message: event.message, agentId }) });
              break;
          }
        }
      } catch (err) {
        if (fullText) {
          await chatService.addMessage(threadId, {
            role: "assistant",
            content: fullText,
            agentId,
            ...(toolCalls.length > 0 ? { metadata: { toolCalls } } : {}),
          });
        }
        await emit({ event: "error", data: JSON.stringify({ message: String(err), agentId }) });
      }
      // Wait for title generation before closing the stream
      if (titlePromise) await titlePromise;
      closeActiveStream(threadId, active);
    });
  });

  return app;
}
