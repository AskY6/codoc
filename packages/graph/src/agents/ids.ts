import type { Brand } from "@cobook/core";

/**
 * Branded identifier for an LLM model. Opaque to this package — we
 * never interpret it. A higher layer (the chat runner, the LLM
 * client adapter) maps `ModelId` to a concrete client.
 *
 * Lives in `agents/` rather than `graph/` or `cobook/` because
 * model selection is a property of an agent, not of the graph
 * runtime itself.
 */
export type ModelId = Brand<string, "ModelId">;

export const ModelId = (s: string): ModelId => s as ModelId;
