// run-agent-turn — composite use case that drives a full agent turn.
//
// This is the 5a core: takes a thread + user text, runs the router →
// specialist graph, persists messages, and returns the result.
//
// The LLM call happens inside the graph run. For the in-memory
// storage used in 5a this is fine; a future slice may split the
// read/write phases around the graph run for real-DB transactions.

import type {
  AgentId,
  ChatMessage,
  CodocId,
  Result,
  ThreadId,
} from "@cobook/core";
import { err, ok } from "@cobook/core";
import {
  buildGraph,
  END,
  type ConditionalBranch,
  type Edge,
  type GraphNode,
  type NodeId,
} from "@cobook/graph";
import {
  buildInitialState,
  createAnthropicLlmClient,
  createGeneralAgent,
  createPerfReviewAgent,
  createPlatformTools,
  createRouterAgent,
  createRssAgent,
  createRssTools,
  eventsToAssistantMessages,
  runChatTurn,
  type ChatEvent,
  type ChatRunContext,
  type ChatState,
  type PlatformToolDeps,
} from "@cobook/chat";
import type { ServiceCtx } from "../../context.js";
import type { ThreadNotFound } from "../../errors.js";
import { agentRepo } from "../../repo/agent.js";
import { codocRepo } from "../../repo/codoc.js";
import { threadAgentRepo } from "../../repo/thread-agent.js";
import { threadCodocRepo } from "../../repo/thread-codoc.js";
import { threadRepo } from "../../repo/thread.js";
import type { ThreadMessage } from "../../types/thread.js";

// ---- Input / Output / Error ----------------------------------------------

export interface RunAgentTurnInput {
  readonly threadId: ThreadId;
  readonly content: string;
  /** Optional LLM client override for testing. */
  readonly llmClient?: import("@cobook/chat").LlmClient | undefined;
  /**
   * Optional streaming callback. Called for every `ChatEvent` emitted
   * by the graph run, in emission order. The use case still collects
   * events internally for persistence; this callback lets callers
   * (e.g. an SSE route) forward them in real-time.
   */
  readonly onEvent?: ((event: ChatEvent) => void) | undefined;
  /** Cooperative cancellation signal (e.g. client disconnect). */
  readonly signal?: AbortSignal | undefined;
  /** Optional confirmation gate for mutating tools. */
  readonly confirmTool?: import("@cobook/chat").ConfirmToolFn | undefined;
}

export interface RunAgentTurnOutput {
  readonly userMessage: ThreadMessage;
  readonly assistantMessages: readonly ThreadMessage[];
  readonly events: readonly ChatEvent[];
}

export type RunAgentTurnError =
  | ThreadNotFound
  | { readonly kind: "graph-build-failed"; readonly message: string }
  | { readonly kind: "graph-run-failed"; readonly message: string };

// ---- Well-known agent ids ------------------------------------------------

const BASE_AGENT_ID = "base" as AgentId;
const RSS_AGENT_ID = "rss" as AgentId;
const PERF_REVIEW_AGENT_ID = "perf-review" as AgentId;
const ROUTER_NODE_ID = "router" as NodeId;

// ---- Use case ------------------------------------------------------------

export async function runAgentTurn(
  ctx: ServiceCtx,
  input: RunAgentTurnInput,
): Promise<Result<RunAgentTurnOutput, RunAgentTurnError>> {
  // 1. Read thread.
  const threadResult = await threadRepo.get(ctx, input.threadId);
  if (!threadResult.ok) return threadResult;
  const thread = threadResult.value;
  const workspaceId = thread.thread.workspaceId;

  // 2. Read thread's linked agents and codocs.
  const [linkedAgentIds, linkedCodocIds, existingMessages] = await Promise.all([
    threadAgentRepo.listByThread(ctx, input.threadId),
    threadCodocRepo.listByThread(ctx, input.threadId),
    threadRepo.listMessages(ctx, input.threadId),
  ]);

  // 3. Mint and persist user message.
  const userMsg: ChatMessage = {
    kind: "user",
    id: ctx.idGen.messageId(),
    threadId: input.threadId,
    content: input.content,
  };
  const appendResult = await threadRepo.appendMessage(ctx, userMsg);
  if (!appendResult.ok) {
    return err({ kind: "thread-not-found" as const, id: input.threadId });
  }
  const userMessage = appendResult.value;

  // 4. Build the full message history including the new user message.
  const allMessages: ChatMessage[] = [
    ...existingMessages.map((m) => m.message),
    userMsg,
  ];

  // 5. Build initial state.
  const initialState = buildInitialState({
    workspaceId,
    threadId: input.threadId,
    messages: allMessages,
    pinnedCodocs: linkedCodocIds,
    activeAgent: null,
  });

  // 6. Construct LLM client (or use injected mock).
  const llm = input.llmClient ?? createAnthropicLlmClient({
    apiKey: ctx.llmConfig.apiKey,
    baseURL: ctx.llmConfig.baseURL,
  });

  // 7. Construct platform tool deps (closing over service ctx).
  const platformDeps: PlatformToolDeps = {
    async listCodocs() {
      return codocRepo.listByWorkspace(ctx, workspaceId);
    },
    async getCodoc(id: string) {
      const r = await codocRepo.getDetail(ctx, id as CodocId);
      return r.ok ? r.value : { error: `Codoc not found: ${id}` };
    },
    async createCodoc(inp: { path?: string; title: string; content: string }) {
      if (!inp.title || !inp.content) {
        return { error: "createCodoc requires both 'title' and 'content' fields" };
      }
      const { createCodoc: create } = await import(
        "../codoc/create-codoc.js"
      );
      const path = inp.path?.trim() || inp.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "untitled";
      const r = await create(ctx, {
        workspaceId,
        path,
        title: inp.title,
        content: inp.content,
      });
      if (!r.ok) return { error: `Failed to create codoc: ${r.error.kind}${"message" in r.error ? ` — ${r.error.message}` : ""}` };
      return r.value;
    },
    async updateCodoc(inp: { id: string; content: string }) {
      if (!inp.id || !inp.content) {
        return { error: "updateCodoc requires both 'id' and 'content' fields" };
      }
      const { updateCodocContent: update } = await import(
        "../codoc/update-codoc-content.js"
      );
      // Read current rev for optimistic update.
      const current = await codocRepo.getDetail(ctx, inp.id as CodocId);
      if (!current.ok) return { error: `Codoc not found: ${inp.id}` };
      const r = await update(ctx, {
        id: inp.id as CodocId,
        content: inp.content,
        expectedRev: current.value.rev,
      });
      return r.ok ? r.value : { error: `Failed to update codoc` };
    },
    async deleteCodoc(id: string) {
      const { deleteCodoc: del } = await import("../codoc/delete-codoc.js");
      const r = await del(ctx, id as CodocId);
      return r.ok ? { ok: true } : { error: `Failed to delete codoc` };
    },
    async getWorkspaceStatus() {
      const codocs = await codocRepo.listByWorkspace(ctx, workspaceId);
      return { totalCodocs: codocs.length };
    },
  };

  const platformTools = createPlatformTools(platformDeps);
  const rssTools = createRssTools();

  // 8. Resolve available agents from the registry.
  const allAgents = await agentRepo.list(ctx);
  // "base" agent is always active — ensure it is in the linked set.
  const linkedAgentSet = new Set(linkedAgentIds.map(String));
  linkedAgentSet.add(BASE_AGENT_ID);

  // Build specialist agents for linked agents.
  const specialists = [];
  const routableAgents: Array<{
    id: AgentId;
    name: string;
    description: string;
  }> = [];

  for (const agentItem of allAgents) {
    if (!linkedAgentSet.has(agentItem.listing.id)) continue;

    const { id, name, description } = agentItem.listing;
    routableAgents.push({ id, name, description });

    if (id === RSS_AGENT_ID) {
      specialists.push(
        createRssAgent(id, [...platformTools, ...rssTools]),
      );
    } else if (id === PERF_REVIEW_AGENT_ID) {
      specialists.push(createPerfReviewAgent(id, platformTools));
    } else {
      // Default: general-shaped specialist with platform tools.
      specialists.push(createGeneralAgent(id, platformTools));
    }
  }

  // 9. Build the graph.
  const router = createRouterAgent(routableAgents);

  // Conditional edge: router → specialist by state.activeAgent.
  const branches: ConditionalBranch<ChatState>[] = specialists.map((s) => ({
    when: (state: ChatState) => state.activeAgent === s.id,
    to: s.id as unknown as NodeId,
  }));
  // Default fallback to first specialist.
  branches.push({
    when: () => true,
    to: specialists[0]!.id as unknown as NodeId,
  });

  const edges: Edge<ChatState>[] = [
    {
      kind: "conditional",
      from: ROUTER_NODE_ID,
      branches,
    },
    // Static edges from each specialist → END.
    ...specialists.map(
      (s): Edge<ChatState> => ({
        kind: "static",
        from: s.id as unknown as NodeId,
        to: END,
      }),
    ),
  ];

  const graphResult = buildGraph<ChatState, ChatEvent>({
    entry: ROUTER_NODE_ID,
    // Agents carry AgentId as their node id brand; the graph spec expects
    // NodeId. Both are branded strings so the cast is safe at runtime.
    nodes: [router, ...specialists] as unknown as GraphNode<
      ChatState,
      ChatEvent
    >[],
    edges,
    reducers: (await import("@cobook/chat")).chatReducers,
  });

  if (!graphResult.ok) {
    return err({
      kind: "graph-build-failed",
      message: graphResult.error.kind,
    });
  }

  // 10. Run the graph.
  const events: ChatEvent[] = [];
  const chatCtx: ChatRunContext = {
    emit: (e) => {
      events.push(e);
      input.onEvent?.(e);
    },
    signal: input.signal ?? AbortSignal.timeout(120_000),
    llm,
    mintMessageId: () => ctx.idGen.messageId(),
    modelConfig: {
      routerModel: ctx.llmConfig.routerModel,
      defaultModel: ctx.llmConfig.defaultModel,
    },
    confirmTool: input.confirmTool,
  };

  const runResult = await runChatTurn(
    graphResult.value,
    initialState,
    chatCtx,
  );

  if (!runResult.ok) {
    const graphErr = runResult.error;
    if (graphErr.kind === "nodeThrew" && graphErr.cause instanceof Error) {
      console.error("[run-agent-turn] nodeThrew:", graphErr.cause.stack ?? graphErr.cause.message);
    }
    const cause = graphErr.kind === "nodeThrew" && graphErr.cause
      ? (graphErr.cause instanceof Error ? graphErr.cause.message : String(graphErr.cause))
      : "";
    return err({
      kind: "graph-run-failed",
      message: cause ? `${graphErr.kind}: ${cause}` : graphErr.kind,
    });
  }

  // 11. Extract and persist assistant messages.
  const assistantChatMessages = eventsToAssistantMessages(events);
  const assistantMessages: ThreadMessage[] = [];

  for (const msg of assistantChatMessages) {
    const r = await threadRepo.appendMessage(ctx, msg);
    if (r.ok) {
      assistantMessages.push(r.value);
    }
  }

  return ok({ userMessage, assistantMessages, events });
}
