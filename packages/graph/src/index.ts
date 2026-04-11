// @cobook/graph — mini-langgraph runtime for cobook agents.
//
// Four subtrees, strictly inward-pointing:
//   graph   — pure mini-langgraph (generic over S, E)
//   cobook  — CobookState / CobookEvent specialization
//   tools   — Tool contract + registry (bound to CobookState)
//   agents  — runtime Agent interface (LLM-driven GraphNode)
//
// Import direction inside this package:
//   agents → tools → cobook → graph
//
// Declarative "an agent exists" records (`AgentListing`) live in
// `@cobook/core` and are NOT re-exported from here.

// ---- graph (pure mini-langgraph) ---------------------------------------
export * from "./graph/index.js";

// ---- cobook (state + event specialization) -----------------------------
export * from "./cobook/index.js";

// ---- tools --------------------------------------------------------------
export * from "./tools/index.js";

// ---- agents -------------------------------------------------------------
export * from "./agents/index.js";
