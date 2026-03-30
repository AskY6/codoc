export type { AssembledContext, AgentExecutor, LLMAgentConfig } from "./types.js";
export { toHandler, createLLMAgentHandler } from "./types.js";
export { formatContextForPrompt, parseIntentBlocks, stripIntentBlocks } from "./types.js";

export { codocAgentParticipant, createCodocAgentHandler, codocAgentExecuteIntent } from "./codoc-agent.js";
export { claudeCodeLogAgentParticipant, createClaudeCodeLogAgentHandler, claudeCodeLogSceneAgent } from "./claude-code-log-agent.js";

export { presetAgents, registerPresetAgents, registerPresetAgentHandlers, initAgentSystem } from "./register.js";
export type { AgentSystemConfig, AgentSystem } from "./register.js";
