// Shared tool-call loop used by specialist agents.
//
// The loop lives inside the agent's `run()`, not in the executor.
// The executor treats each agent node as a single step; the agent's
// internal loop is transparent to the graph.
//
// Pattern: call LLM → if tool_use, execute tools, feed results
// back → repeat until the LLM produces a final text response or
// the iteration limit is reached.

import type { AgentId, ChatMessage } from "@cobook/core";
import { noopLogger, type NodeId } from "@cobook/graph";
import type { ChatEvent } from "../state/events.js";
import type { ChatState } from "../state/state.js";
import type {
  ChatRunContext,
  LlmContentBlock,
  LlmMessage,
  LlmResponseBlock,
  LlmToolDef,
} from "../runner/context.js";
import type { ChatTool } from "../state/aliases.js";

const MAX_TOOL_ITERATIONS = 10;

/** Tools that mutate codocs — require user confirmation when a gate is provided. */
const CONFIRMATION_REQUIRED = new Set([
  "createCodoc",
  "updateCodoc",
  "deleteCodoc",
]);

interface ToolLoopParams {
  readonly agentId: AgentId;
  readonly nodeId: NodeId;
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: readonly ChatTool[];
  readonly state: ChatState;
  readonly ctx: ChatRunContext;
  readonly maxTokens?: number;
  /** When set, replaces state.messages as the LLM conversation history.
   *  Used by parallel workers to inject synthetic per-item context. */
  readonly overrideMessages?: readonly LlmMessage[];
}

/**
 * Run the LLM tool-call loop and return the final assistant message
 * as a `ChatMessage` plus the partial state update.
 */
/** Retry-storm tracker: detects an agent calling the same failing tool repeatedly. */
interface FailureRecord {
  count: number;
  lastInput: string; // JSON-serialised for comparison
  lastError: string;
}

export async function runToolLoop(
  params: ToolLoopParams,
): Promise<Partial<ChatState>> {
  const { agentId, nodeId, model, systemPrompt, tools, state, ctx } = params;
  const log = ctx.log ?? noopLogger;
  const messageId = ctx.mintMessageId();

  // Build tool defs for the LLM.
  const llmToolDefs: LlmToolDef[] = tools.map((t) => ({
    name: t.schema.name,
    description: t.schema.description,
    input_schema: t.schema.inputSchema,
  }));

  // Build tool lookup.
  const toolMap = new Map(tools.map((t) => [t.schema.name, t]));

  // Convert ChatMessages to LlmMessages (or use caller-provided override).
  const llmMessages: LlmMessage[] = params.overrideMessages
    ? [...params.overrideMessages]
    : state.messages
        .filter((m) => m.kind === "user" || m.kind === "assistant")
        .map((m) => ({
          role: m.kind as "user" | "assistant",
          content: m.content,
        }));

  const allToolCalls: Array<{
    name: string;
    input: Readonly<Record<string, unknown>>;
  }> = [];
  const allToolResults: Array<{ name: string; output: unknown }> = [];

  // Retry-storm detection: track consecutive failures per tool.
  const failures = new Map<string, FailureRecord>();

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    log.info({ scope: "tool-loop", event: "llm:call", agentId, model, iteration: iterations });
    const llmStart = Date.now();

    const response = await ctx.llm.createMessage({
      model,
      maxTokens: params.maxTokens ?? 4096,
      system: systemPrompt,
      messages: llmMessages,
      ...(llmToolDefs.length > 0 && { tools: llmToolDefs }),
      signal: ctx.signal,
    });

    // Extract text and tool_use blocks.
    let fullText = "";
    const toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Readonly<Record<string, unknown>>;
    }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        fullText += block.text;
      } else if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    log.info({
      scope: "tool-loop",
      event: "llm:response",
      agentId,
      iteration: iterations,
      toolCallCount: toolUseBlocks.length,
      hasText: fullText.length > 0,
      stopReason: response.stop_reason,
      durationMs: Date.now() - llmStart,
    });

    // LLM hit token limit — tool_use inputs are likely truncated.
    // Discard tool calls and return whatever text we have.
    if (response.stop_reason === "max_tokens" && toolUseBlocks.length > 0) {
      log.warn({
        scope: "tool-loop",
        event: "tool:truncated",
        agentId,
        iteration: iterations,
        discardedTools: toolUseBlocks.map((b) => b.name),
      });
      const finalMessage: ChatMessage = {
        kind: "assistant",
        id: messageId,
        threadId: state.threadId!,
        content: fullText || "Response was too long and got truncated. Please try a shorter request.",
        agentId,
        metadata: { toolCalls: allToolCalls, toolResults: allToolResults },
      };
      ctx.emit({ kind: "done", finalMessage });
      return { messages: [finalMessage] };
    }

    // No tool calls → done.
    if (toolUseBlocks.length === 0) {
      if (fullText) {
        ctx.emit({ kind: "token", nodeId, delta: fullText });
      }
      const finalMessage: ChatMessage = {
        kind: "assistant",
        id: messageId,
        threadId: state.threadId!,
        content: fullText,
        agentId,
        metadata: { toolCalls: allToolCalls, toolResults: allToolResults },
      };
      ctx.emit({ kind: "done", finalMessage });
      return { messages: [finalMessage] };
    }

    // Emit text as status (transient, not the final response).
    if (fullText) {
      ctx.emit({ kind: "token", nodeId, delta: fullText });
    }

    // Append assistant response with tool_use blocks.
    llmMessages.push({
      role: "assistant",
      content: response.content as unknown as LlmContentBlock[],
    });

    // Execute each tool and collect results.
    const toolResults: LlmContentBlock[] = [];

    for (const toolUse of toolUseBlocks) {
      ctx.emit({
        kind: "toolCall",
        nodeId,
        tool: toolUse.name,
        input: toolUse.input,
      });

      allToolCalls.push({ name: toolUse.name, input: toolUse.input });

      log.info({ scope: "tool-loop", event: "tool:call", agentId, tool: toolUse.name, iteration: iterations });
      const toolStart = Date.now();

      // TODO: Re-enable confirmation gate once the frontend confirmation
      // UX is stable. Currently bypassed to avoid 2-min auto-deny timeouts
      // blocking agent turns silently.
      //
      // Confirmation gate: pause for user approval on mutating tools.
      // if (
      //   ctx.confirmTool &&
      //   CONFIRMATION_REQUIRED.has(toolUse.name)
      // ) {
      //   const requestId = `${nodeId}-${toolUse.id}`;
      //   ctx.emit({
      //     kind: "confirmationRequest",
      //     requestId,
      //     nodeId,
      //     tool: toolUse.name,
      //     input: toolUse.input,
      //   });
      //   const approved = await ctx.confirmTool(toolUse.name, toolUse.input);
      //   if (!approved) {
      //     const output = { denied: true, message: "User denied this action." };
      //     allToolResults.push({ name: toolUse.name, output });
      //     ctx.emit({ kind: "toolResult", nodeId, tool: toolUse.name, output });
      //     toolResults.push({
      //       type: "tool_result",
      //       tool_use_id: toolUse.id,
      //       content: JSON.stringify(output),
      //     });
      //     continue;
      //   }
      // }

      const tool = toolMap.get(toolUse.name);
      let output: unknown;
      let toolOk: boolean;
      if (tool) {
        const result = await tool.execute(toolUse.input, state, ctx);
        toolOk = result.ok;
        output = result.ok ? result.value : { error: result.error.message };
      } else {
        toolOk = false;
        output = { error: `Unknown tool: ${toolUse.name}` };
      }

      const toolDurationMs = Date.now() - toolStart;
      log.info({ scope: "tool-loop", event: "tool:result", agentId, tool: toolUse.name, iteration: iterations, ok: toolOk, durationMs: toolDurationMs });

      // Retry-storm detection.
      if (!toolOk) {
        const inputKey = JSON.stringify(toolUse.input);
        const errorStr = typeof output === "object" && output !== null && "error" in output
          ? String((output as { error: unknown }).error)
          : "unknown";
        const prev = failures.get(toolUse.name);
        if (prev && prev.lastInput === inputKey) {
          prev.count++;
          prev.lastError = errorStr;
        } else {
          failures.set(toolUse.name, { count: 1, lastInput: inputKey, lastError: errorStr });
        }
        const record = failures.get(toolUse.name)!;
        if (record.count >= 2) {
          log.warn({
            scope: "tool-loop",
            event: "tool:retry-storm",
            agentId,
            tool: toolUse.name,
            consecutiveFailures: record.count,
            lastError: record.lastError,
          });
        }
      } else {
        // Success resets the tracker for this tool.
        failures.delete(toolUse.name);
      }

      allToolResults.push({ name: toolUse.name, output });

      ctx.emit({
        kind: "toolResult",
        nodeId,
        tool: toolUse.name,
        output,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(output),
      });
    }

    // Feed tool results back to the LLM.
    llmMessages.push({ role: "user", content: toolResults });
  }

  // Exhausted tool call limit — return what we have.
  log.warn({ scope: "tool-loop", event: "loop:exhausted", agentId, iterations });
  const finalMessage: ChatMessage = {
    kind: "assistant",
    id: messageId,
    threadId: state.threadId!,
    content: `Reached maximum tool call limit (${MAX_TOOL_ITERATIONS}).`,
    agentId,
    metadata: { toolCalls: allToolCalls, toolResults: allToolResults },
  };
  ctx.emit({ kind: "done", finalMessage });
  return { messages: [finalMessage] };
}
