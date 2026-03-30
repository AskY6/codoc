export { formatContextForPrompt, parseIntentBlocks, stripIntentBlocks } from "./utils.js";

export { codocStructureAgent } from "./codoc-structure-agent.js";
export { claudeLogAgent } from "./claude-log-agent.js";

export { initAgentSystem } from "./register.js";
export type { AgentSystemConfig, AgentSystem } from "./register.js";
