// agents/ — concrete ChatAgent implementations.
//
// Router is the entry node (Haiku classifier, no tools).
// General and RSS are specialist nodes (Sonnet, with tools).
// run-tool-loop is an internal shared helper.

export { createRouterAgent } from "./router.js";
export { createGeneralAgent } from "./general.js";
export { createRssAgent } from "./rss.js";
