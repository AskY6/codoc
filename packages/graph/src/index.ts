// @cobook/graph — mini-langgraph runtime for agent-shaped workloads.
//
// Three subtrees, strictly inward-pointing:
//   graph   — pure mini-langgraph (generic over S, E)
//   tools   — Tool<S, E> contract + registry (generic)
//   agents  — Agent<S, E> runtime interface (generic, id-branded)
//
// Import direction inside this package:
//   agents → tools → graph
//
// This package is **free of application concepts**. State / event
// specializations (`ChatState`, `ChatEvent`, reducers) and the
// `ChatTool` / `ChatAgent` / `ChatGraph` aliases live in
// `@cobook/chat`. Declarative "an agent exists" records
// (`AgentListing`) live in `@cobook/core` and are NOT re-exported
// from here.

// ---- graph (pure mini-langgraph) ---------------------------------------
export * from "./graph/index.js";

// ---- tools --------------------------------------------------------------
export * from "./tools/index.js";

// ---- agents -------------------------------------------------------------
export * from "./agents/index.js";
