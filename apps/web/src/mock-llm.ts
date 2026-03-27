import type { LLMClient } from "@codoc/core";

/**
 * Mock LLM client for M3 demo.
 * Simulates a ~500ms delay and returns a deterministic response based on the prompt.
 */
export const mockLLMClient: LLMClient = {
  async generate({ prompt, schema }) {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 500));

    // Generate a plausible mock response
    const response = `This is a CoDoc demo showcasing the reactive document runtime with four loader types: literal values, $ref cross-references, $source HTTP fetching, and $prompt LLM generation — all wired through a unified observe/force/propagate pipeline.`;

    // If schema expects an object, wrap it
    if (schema && (schema as Record<string, unknown>)["type"] === "object") {
      return { text: response };
    }
    return response;
  },
};
