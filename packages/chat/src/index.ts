// @cobook/chat — chat runtime built on @cobook/graph.
//
// Five subtrees, strictly inward-pointing:
//   state   — ChatState, ChatEvent, reducers, Chat* aliases
//   adapter — ChatMessage ↔ ChatState / ChatEvent translation
//   runner  — end-to-end chat turn runner + LLM client + adapter
//   tools   — concrete ChatTool implementations
//   agents  — concrete ChatAgent implementations (router, specialists)
//
// Plus a registry builder at the root.
//
// Import direction inside this package:
//   agents → tools → runner → adapter → state → @cobook/graph / @cobook/core

// ---- state (chat state + event types + <S, E> aliases) ----------------
export * from "./state/index.js";

// ---- adapter (ChatMessage ↔ chat state/event) --------------------------
export * from "./adapter/index.js";

// ---- runner (chat turn driver + LLM client) ----------------------------
export * from "./runner/index.js";

// ---- tools (platform + RSS) --------------------------------------------
export * from "./tools/index.js";

// ---- agents (router + specialists) -------------------------------------
export * from "./agents/index.js";

// ---- registry -----------------------------------------------------------
export { buildChatAgentRegistry, buildChatToolRegistry } from "./registry.js";
