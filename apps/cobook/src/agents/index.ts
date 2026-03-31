export { formatContextForPrompt, parseIntentBlocks, stripIntentBlocks } from "./utils.js";

export { codocStructureAgent } from "./implementations/codoc-structure-agent.js";
export { claudeLogAgent } from "./implementations/claude-log-agent.js";

export { executeIntent } from "./executor.js";

export { initAgentSystem } from "./register.js";
export type { AgentSystemConfig, AgentSystem } from "./register.js";
