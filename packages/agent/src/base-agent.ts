import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool, MAX_TOOL_CALLS } from "./tools.js";
import type { Agent, AgentContext, AgentMessage, ChatEvent, LLMConfig } from "./types.js";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `You are the Cobook assistant — a helpful AI that operates within a Cobook workspace.

A Cobook workspace contains .codoc files (YAML-based documents with meta, data, and view sections) that form a dependency graph (DAG). You can:

- List all codocs and their states
- Read individual codoc content and resolved data
- Check workspace status (node state distribution)
- Create new codocs
- Update existing codocs

When the user asks about their workspace, use the tools to get accurate information rather than guessing. Be concise and helpful. When creating or updating codocs, generate valid YAML content that follows the codoc format.`;

// ---------------------------------------------------------------------------
// Tool executor type — allows agents to provide custom executors
// ---------------------------------------------------------------------------

export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Agent config — extends LLM config with agent-specific options
// ---------------------------------------------------------------------------

export interface AgentConfig extends LLMConfig {
  name?: string;
  description?: string;
  systemPrompt?: string;
  tools?: Anthropic.Tool[];
  toolExecutor?: ToolExecutor;
}

// ---------------------------------------------------------------------------
// Base agent factory
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function createBaseAgent(config?: AgentConfig): Agent {
  const client = new Anthropic({
    ...(config?.baseURL && { baseURL: config.baseURL }),
    ...(config?.apiKey && { apiKey: config.apiKey }),
  });
  const model = config?.model ?? DEFAULT_MODEL;
  const systemPrompt = config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const tools = config?.tools ?? toolDefinitions;
  const runTool = config?.toolExecutor ?? executeTool;

  return {
    name: config?.name ?? "Assistant",
    description: config?.description ?? "General-purpose assistant",
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
        try {
          const response = await client.messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages: anthropicMessages,
          });

          // Extract text and tool_use blocks from response
          let fullText = "";
          const toolUseBlocks: Array<{
            id: string;
            name: string;
            input: Record<string, unknown>;
          }> = [];

          for (const block of response.content) {
            if (block.type === "text") {
              fullText += block.text;
            } else if (block.type === "tool_use") {
              toolUseBlocks.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }

          // If no tool calls, we're done — emit text as final response
          if (toolUseBlocks.length === 0) {
            if (fullText) {
              yield { kind: "text-delta", text: fullText };
            }
            yield { kind: "done", fullText };
            return;
          }

          // Tool calls present — emit text as transient status, not message content
          if (fullText) {
            yield { kind: "status", text: fullText };
          }

          // Execute tool calls and build tool results
          anthropicMessages.push({
            role: "assistant",
            content: response.content,
          });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tool of toolUseBlocks) {
            toolCallCount++;
            yield { kind: "tool-use", toolName: tool.name, input: tool.input };

            let result: unknown;
            try {
              result = await runTool(tool.name, tool.input, ctx);
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
