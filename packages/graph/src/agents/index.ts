// agents/ — runtime Agent interface and registry. An Agent is a
// GraphNode specialization bound to CobookState / CobookEvent,
// driven by an LLM, and composing Tools.
//
// The declarative directory record (AgentListing) lives in
// @cobook/core and is NOT re-exported from here.

export { ModelId } from "./ids.js";
export type { Agent } from "./agent.js";
export type { AgentRegistry } from "./registry.js";
