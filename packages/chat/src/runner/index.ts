// runner/ — end-to-end chat turn runner. Thin wrapper over
// @cobook/graph's `runGraph` that takes a chat-bound graph plus
// a seeded ChatState and drives the turn to completion.
//
// This is the public entry point for a service layer that wants
// to run a chat turn without thinking about the graph executor
// directly.

export { runChatTurn } from "./runner.js";
export type {
  LlmClient,
  LlmMessage,
  LlmContentBlock,
  LlmToolDef,
  LlmResponseBlock,
  LlmResponse,
  ChatRunContext,
  ModelConfig,
  ConfirmToolFn,
} from "./context.js";
export {
  createAnthropicLlmClient,
  type AnthropicLlmConfig,
} from "./llm-adapter.js";
