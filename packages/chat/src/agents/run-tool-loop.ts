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
import type { NodeId } from "@cobook/graph";
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

interface ToolLoopParams {
  readonly agentId: AgentId;
  readonly nodeId: NodeId;
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: readonly ChatTool[];
  readonly state: ChatState;
  readonly ctx: ChatRunContext;
}

/**
 * Run the LLM tool-call loop and return the final assistant message
 * as a `ChatMessage` plus the partial state update.
 */
export async function runToolLoop(
  params: ToolLoopParams,
): Promise<Partial<ChatState>> {
  const { agentId, nodeId, model, systemPrompt, tools, state, ctx } = params;
  const messageId = ctx.mintMessageId();

  // Build tool defs for the LLM.
  const llmToolDefs: LlmToolDef[] = tools.map((t) => ({
    name: t.schema.name,
    description: t.schema.description,
    input_schema: t.schema.inputSchema,
  }));

  // Build tool lookup.
  const toolMap = new Map(tools.map((t) => [t.schema.name, t]));

  // Convert ChatMessages to LlmMessages.
  const llmMessages: LlmMessage[] = state.messages
    .filter((m) => m.kind === "user" || m.kind === "assistant")
    .map((m) => ({
      role: m.kind as "user" | "assistant",
      content: m.content,
    }));

  const allToolCalls: Array<{
    name: string;
    input: Readonly<Record<string, unknown>>;
  }> = [];

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ctx.llm.createMessage({
      model,
      maxTokens: 4096,
      system: systemPrompt,
      messages: llmMessages,
      ...(llmToolDefs.length > 0 && { tools: llmToolDefs }),
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
        metadata: { toolCalls: allToolCalls },
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

      const tool = toolMap.get(toolUse.name);
      let output: unknown;
      if (tool) {
        const result = await tool.execute(toolUse.input, state, ctx);
        output = result.ok ? result.value : { error: result.error.message };
      } else {
        output = { error: `Unknown tool: ${toolUse.name}` };
      }

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
  const finalMessage: ChatMessage = {
    kind: "assistant",
    id: messageId,
    threadId: state.threadId!,
    content: `Reached maximum tool call limit (${MAX_TOOL_ITERATIONS}).`,
    agentId,
    metadata: { toolCalls: allToolCalls },
  };
  ctx.emit({ kind: "done", finalMessage });
  return { messages: [finalMessage] };
}
