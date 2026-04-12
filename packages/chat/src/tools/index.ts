// tools/ — concrete ChatTool implementations.
//
// Platform tools are available to all agents; RSS tools are
// specialist-specific. Each module exports a factory that takes
// its dependencies and returns a readonly ChatTool[].

export { createPlatformTools, type PlatformToolDeps } from "./platform.js";
export { createRssTools } from "./rss.js";
