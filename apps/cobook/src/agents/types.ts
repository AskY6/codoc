import type {
  AgentHandler,
  ContextData,
  Intent,
  Message,
  ResponseAction,
} from "../chat/types.js";
import { getClient, getModel } from "../shared/ai.js";

export type AssembledContext = ContextData[];

export interface AgentExecutor {
  execute(
    context: AssembledContext,
    triggerMessage: Message,
  ): Promise<ResponseAction | null>;
}

export function toHandler(executor: AgentExecutor): AgentHandler {
  return (ctx, msg) => executor.execute(ctx, msg);
}

// --- Shared LLM agent handler ---

export interface LLMAgentConfig {
  agentId: string;
  systemPrompt: string;
  maxTokens?: number;
}

export function createLLMAgentHandler(config: LLMAgentConfig): AgentHandler {
  return async (context, triggerMessage) => {
    const client = getClient();
    const contextText = formatContextForPrompt(context);
    const messageText = formatTriggerMessage(triggerMessage);

    const response = await client.messages.create({
      model: getModel(),
      max_tokens: config.maxTokens ?? 2048,
      system: config.systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: contextText
            ? `Context:\n${contextText}\n\n${messageText}`
            : messageText,
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    if (!text) return null;

    const intents = parseIntentBlocks(text);
    const content = stripIntentBlocks(text);

    return {
      type: "reply",
      message: {
        sender: { id: config.agentId, kind: "agent" as const },
        content,
        intents: intents.length > 0 ? intents : undefined,
      },
    };
  };
}

// --- Prompt formatting ---

export function formatContextForPrompt(context: AssembledContext): string {
  if (context.length === 0) return "";
  return context.map((c) => `[${c.kind}]\n${c.content}`).join("\n\n");
}

function formatTriggerMessage(message: Message): string {
  let text = `Message from ${message.sender.id}:\n${message.content}`;
  if (message.intents?.length) {
    text += "\n\nAttached intents:";
    for (const intent of message.intents) {
      text += `\n- ${intent.kind} (${intent.status}): ${JSON.stringify(intent.payload)}`;
    }
  }
  if (message.resourceRefs?.length) {
    text += "\n\nReferenced resources:";
    for (const ref of message.resourceRefs) {
      text += `\n- ${ref.kind}: ${ref.id}${ref.label ? ` (${ref.label})` : ""}`;
    }
  }
  return text;
}

// --- Intent parsing ---

export function parseIntentBlocks(text: string): Intent[] {
  const intents: Intent[] = [];
  const re = /<intent>\s*([\s\S]*?)\s*<\/intent>/g;
  for (const match of text.matchAll(re)) {
    try {
      const parsed = JSON.parse(match[1]);
      intents.push({
        kind: parsed.kind,
        payload: parsed.payload,
        status: "proposed",
      });
    } catch {
      // Skip malformed intent blocks
    }
  }
  return intents;
}

export function stripIntentBlocks(text: string): string {
  return text.replace(/<intent>\s*[\s\S]*?\s*<\/intent>/g, "").trim();
}
