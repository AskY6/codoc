import type { LLMClient } from "@codoc/core";

const responses: Record<string, string> = {
  product:
    "A powerhouse laptop designed for professionals who demand top-tier performance, stunning display quality, and all-day battery life.",
  bio:
    "A dedicated power user who leverages cutting-edge tools to streamline workflows and deliver outstanding results.",
  order:
    "Order confirmed — items will be shipped to the customer within 2-3 business days with priority handling.",
};

function pickResponse(prompt: string): string {
  if (prompt.includes("product description")) return responses.product;
  if (prompt.includes("bio")) return responses.bio;
  if (prompt.includes("order")) return responses.order;
  return `Mock LLM response for: ${prompt.slice(0, 60)}...`;
}

/**
 * Mock LLM client for demo.
 * Simulates a ~500ms delay and returns a context-aware response.
 */
export const mockLLMClient: LLMClient = {
  async generate({ prompt, schema }) {
    await new Promise((r) => setTimeout(r, 500));

    const response = pickResponse(prompt);

    if (schema && (schema as Record<string, unknown>)["type"] === "object") {
      return { text: response };
    }
    return response;
  },
};
