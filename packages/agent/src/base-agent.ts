import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool, MAX_TOOL_CALLS } from "./tools.js";
import type { Agent, AgentContext, AgentMessage, ChatEvent, LLMConfig } from "./types.js";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Cobook assistant — a helpful AI that operates within a Cobook workspace.

A Cobook workspace contains .codoc files (YAML-based documents with meta, data, and view sections) that form a dependency graph (DAG). You can:

- List all codocs and their states
- Read individual codoc content and resolved data
- Check workspace status (node state distribution)
- Create new codocs
- Update existing codocs

When the user asks about their workspace, use the tools to get accurate information rather than guessing. Be concise and helpful. When creating or updating codocs, generate valid YAML content that follows the codoc format.`;

// ---------------------------------------------------------------------------
// Base agent factory
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function createBaseAgent(config?: LLMConfig): Agent {
  const client = new Anthropic({
    ...(config?.baseURL && { baseURL: config.baseURL }),
    ...(config?.apiKey && { apiKey: config.apiKey }),
  });
  const model = config?.model ?? DEFAULT_MODEL;

  return {
    async *run(
      messages: AgentMessage[],
      ctx: AgentContext,
    ): AsyncGenerator<ChatEvent> {
      // Convert to Anthropic message format
      const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let toolCallCount = 0;

      // Tool-call loop: keep calling the LLM until it produces a final text response
      while (toolCallCount < MAX_TOOL_CALLS) {
        let fullText = "";
        const toolUseBlocks: Array<{
          id: string;
          name: string;
          input: Record<string, unknown>;
        }> = [];

        try {
          const stream = client.messages.stream({
            model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: toolDefinitions,
            messages: anthropicMessages,
          });

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              fullText += event.delta.text;
              yield { kind: "text-delta", text: event.delta.text };
            }

            if (
              event.type === "content_block_delta" &&
              event.delta.type === "input_json_delta"
            ) {
              // Accumulate tool input JSON — handled at message_stop
            }
          }

          // Get the final message to check for tool use
          const finalMessage = await stream.finalMessage();

          // Collect tool_use blocks
          for (const block of finalMessage.content) {
            if (block.type === "tool_use") {
              toolUseBlocks.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }

          // If no tool calls, we're done
          if (toolUseBlocks.length === 0) {
            yield { kind: "done", fullText };
            return;
          }

          // Execute tool calls and build tool results
          anthropicMessages.push({
            role: "assistant",
            content: finalMessage.content,
          });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tool of toolUseBlocks) {
            toolCallCount++;
            yield { kind: "tool-use", toolName: tool.name, input: tool.input };

            let result: unknown;
            try {
              result = await executeTool(tool.name, tool.input, ctx);
            } catch (err) {
              result = { error: String(err) };
            }

            yield { kind: "tool-result", toolName: tool.name, output: result };

            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: JSON.stringify(result),
            });
          }

          // Feed tool results back to the LLM
          anthropicMessages.push({
            role: "user",
            content: toolResults,
          });

          // Reset fullText for next iteration
          fullText = "";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          yield { kind: "error", message };
          return;
        }
      }

      // If we exhausted tool call limit
      yield {
        kind: "error",
        message: `Reached maximum tool call limit (${MAX_TOOL_CALLS})`,
      };
    },
  };
}
