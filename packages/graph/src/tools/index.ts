// tools/ — tool contract and registry. Generic over S and E; no
// reverse dependency on agents/.

export { ToolId } from "./ids.js";
export type { ToolSchema, ToolError, Tool } from "./tool.js";
export type { ToolRegistry } from "./registry.js";
