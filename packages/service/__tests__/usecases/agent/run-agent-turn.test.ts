import { AgentId } from "@cobook/core";
import type { LlmClient, LlmResponse } from "@cobook/chat";
import { describe, expect, it } from "vitest";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { createThread } from "../../../src/usecases/thread/create-thread.js";
import { setWorkspaceAgents } from "../../../src/usecases/agent/set-workspace-agents.js";
import { runAgentTurn } from "../../../src/usecases/agent/run-agent-turn.js";
import { getThread } from "../../../src/usecases/thread/get-thread.js";
import { makeTestCtx } from "../../helpers/ctx.js";

/**
 * Creates a mock LlmClient that returns canned responses in order.
 */
function mockLlmClient(responses: LlmResponse[]): LlmClient {
  let callIndex = 0;
  return {
    async createMessage(): Promise<LlmResponse> {
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return response;
    },
  };
}

/** Seed workspace + base agent + thread. */
async function setupWorkspaceWithThread(
  ctx: ReturnType<typeof makeTestCtx>["ctx"],
) {
  const ws = await createWorkspace(ctx, {
    name: "Test Workspace",
    description: null,
  });
  if (!ws.ok) throw new Error("setup: createWorkspace failed");

  await ctx.storage.agents.create(ctx.storageCtx, {
    id: AgentId("base"),
    name: "Cobook Assistant",
    description: "General workspace assistant",
  });

  await setWorkspaceAgents(ctx, {
    workspaceId: ws.value.id,
    agentIds: [AgentId("base")],
  });

  const thread = await createThread(ctx, {
    workspaceId: ws.value.id,
    title: null,
  });
  if (!thread.ok) throw new Error("setup: createThread failed");

  return { workspaceId: ws.value.id, threadId: thread.value.thread.id };
}

describe("runAgentTurn", () => {
  it("persists user + assistant messages and collects events", async () => {
    const { ctx } = makeTestCtx();
    const { threadId } = await setupWorkspaceWithThread(ctx);

    const llm = mockLlmClient([
      // Router: classify to "base".
      {
        content: [{ type: "text", text: '{"route": "base"}' }],
        stop_reason: "end_turn",
      },
      // Specialist: final text response.
      {
        content: [{ type: "text", text: "Hello! I can help with your workspace." }],
        stop_reason: "end_turn",
      },
    ]);

    const result = await runAgentTurn(ctx, {
      threadId,
      content: "Hi there",
      llmClient: llm,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // User message was persisted.
    expect(result.value.userMessage.message.kind).toBe("user");
    expect(result.value.userMessage.message.content).toBe("Hi there");

    // Assistant message was persisted.
    expect(result.value.assistantMessages).toHaveLength(1);
    const assistant = result.value.assistantMessages[0]!;
    expect(assistant.message.kind).toBe("assistant");
    expect(assistant.message.content).toBe(
      "Hello! I can help with your workspace.",
    );
    if (assistant.message.kind === "assistant") {
      expect(assistant.message.agentId).toBe(AgentId("base"));
    }

    // Events include agent handoff + token + done.
    expect(result.value.events.length).toBeGreaterThanOrEqual(2);
    const doneEvent = result.value.events.find((e) => e.kind === "done");
    expect(doneEvent).toBeDefined();

    // Thread now has both messages.
    const detail = await getThread(ctx, threadId);
    if (!detail.ok) throw new Error("getThread failed");
    expect(detail.value.messages).toHaveLength(2);
    expect(detail.value.messages[0]!.message.kind).toBe("user");
    expect(detail.value.messages[1]!.message.kind).toBe("assistant");
  });

  it("handles tool-call loop in specialist agent", async () => {
    const { ctx } = makeTestCtx();
    const { threadId } = await setupWorkspaceWithThread(ctx);

    const llm = mockLlmClient([
      // Router: classify to "base".
      {
        content: [{ type: "text", text: '{"route": "base"}' }],
        stop_reason: "end_turn",
      },
      // Specialist: tool call (listCodocs).
      {
        content: [
          { type: "text", text: "Let me check..." },
          {
            type: "tool_use",
            id: "tool_1",
            name: "listCodocs",
            input: {},
          },
        ],
        stop_reason: "tool_use",
      },
      // Specialist: final text after tool result.
      {
        content: [
          { type: "text", text: "Your workspace has no codocs yet." },
        ],
        stop_reason: "end_turn",
      },
    ]);

    const result = await runAgentTurn(ctx, {
      threadId,
      content: "What codocs do I have?",
      llmClient: llm,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Events include toolCall + toolResult.
    const toolCallEvent = result.value.events.find(
      (e) => e.kind === "toolCall",
    );
    expect(toolCallEvent).toBeDefined();
    if (toolCallEvent?.kind === "toolCall") {
      expect(toolCallEvent.tool).toBe("listCodocs");
    }

    const toolResultEvent = result.value.events.find(
      (e) => e.kind === "toolResult",
    );
    expect(toolResultEvent).toBeDefined();

    // Final assistant message.
    expect(result.value.assistantMessages).toHaveLength(1);
    expect(result.value.assistantMessages[0]!.message.content).toBe(
      "Your workspace has no codocs yet.",
    );

    // Tool calls recorded in metadata.
    const msg = result.value.assistantMessages[0]!.message;
    if (msg.kind === "assistant") {
      expect(msg.metadata.toolCalls).toHaveLength(1);
      expect(msg.metadata.toolCalls[0]!.name).toBe("listCodocs");
    }
  });

  it("thread creation inherits workspace agents", async () => {
    const { ctx } = makeTestCtx();
    const { workspaceId } = await setupWorkspaceWithThread(ctx);

    // Seed another agent.
    await ctx.storage.agents.create(ctx.storageCtx, {
      id: AgentId("rss"),
      name: "RSS Reader",
      description: "Subscribe to RSS feeds",
    });

    // Link both agents to workspace.
    await setWorkspaceAgents(ctx, {
      workspaceId,
      agentIds: [AgentId("base"), AgentId("rss")],
    });

    // Create a new thread — should inherit both agents.
    const thread2 = await createThread(ctx, {
      workspaceId,
      title: "Second thread",
    });
    if (!thread2.ok) throw new Error("createThread failed");

    const detail = await getThread(ctx, thread2.value.thread.id);
    if (!detail.ok) throw new Error("getThread failed");

    expect(detail.value.agentIds).toHaveLength(2);
    expect(detail.value.agentIds).toContain(AgentId("base"));
    expect(detail.value.agentIds).toContain(AgentId("rss"));
  });

  it("returns thread-not-found for a missing thread", async () => {
    const { ctx } = makeTestCtx();

    const result = await runAgentTurn(ctx, {
      threadId: "thread_nope" as import("@cobook/core").ThreadId,
      content: "Hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("thread-not-found");
    }
  });
});
