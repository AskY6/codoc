// Anthropic LLM adapter — the ONLY file in the new stack that
// imports `@anthropic-ai/sdk`. Maps our vendor-neutral `LlmClient`
// interface to the Anthropic Messages API.

import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmResponseBlock,
  LlmToolDef,
} from "./context.js";

export interface AnthropicLlmConfig {
  readonly apiKey?: string | undefined;
  readonly baseURL?: string | undefined;
}

export function createAnthropicLlmClient(
  config?: AnthropicLlmConfig,
): LlmClient {
  const client = new Anthropic({
    ...(config?.apiKey && { apiKey: config.apiKey }),
    ...(config?.baseURL && { baseURL: config.baseURL }),
  });

  return {
    async createMessage(params): Promise<LlmResponse> {
      const messages: Anthropic.MessageParam[] = params.messages.map(
        (m: LlmMessage) => ({
          role: m.role,
          content: m.content as Anthropic.MessageParam["content"],
        }),
      );

      const tools: Anthropic.Tool[] | undefined = params.tools?.map(
        (t: LlmToolDef) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }),
      );

      const response = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages,
        ...(tools && tools.length > 0 && { tools }),
      });

      const content: LlmResponseBlock[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          content.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Readonly<Record<string, unknown>>,
          });
        }
        // Skip thinking, redacted_thinking, and other block types.
      }

      return {
        content,
        stop_reason: response.stop_reason ?? "end_turn",
      };
    },
  };
}
