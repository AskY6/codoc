// @cobook/chat — chat runtime built on @cobook/graph.
//
// Three subtrees, strictly inward-pointing:
//   state   — ChatState, ChatEvent, reducers, Chat* aliases
//   adapter — ChatMessage ↔ ChatState / ChatEvent translation
//   runner  — end-to-end chat turn runner
//
// Import direction inside this package:
//   runner → adapter → state → @cobook/graph / @cobook/core

// ---- state (chat state + event types + <S, E> aliases) ----------------
export * from "./state/index.js";

// ---- adapter (ChatMessage ↔ chat state/event) --------------------------
export * from "./adapter/index.js";

// ---- runner (chat turn driver) -----------------------------------------
export * from "./runner/index.js";
