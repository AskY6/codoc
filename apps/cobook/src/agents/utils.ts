import type { ContextData, Intent } from "../chat/types.js";

export type AssembledContext = ContextData[];

/**
 * Format assembled context data into a text block for LLM prompts.
 */
export function formatContextForPrompt(context: AssembledContext): string {
  if (context.length === 0) return "";
  return context.map((c) => `[${c.kind}]\n${c.content}`).join("\n\n");
}

/**
 * Parse `<intent>` XML blocks from LLM output text.
 */
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

/**
 * Strip `<intent>` blocks from text, leaving only the conversational reply.
 */
export function stripIntentBlocks(text: string): string {
  return text.replace(/<intent>\s*[\s\S]*?\s*<\/intent>/g, "").trim();
}
