import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | undefined;

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  return _client;
}

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
}
