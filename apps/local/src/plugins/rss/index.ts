// RSS plugin — vertical workspace capability pack for RSS reading.
//
// Owns: template, config, detection, article state API, UI descriptor,
//       agent instructions.
// Does NOT own: source scheduler (platform), rssProvider (parser layer).

import type { WorkspacePlugin } from "../types.js";
import type { RssPluginConfig } from "./config.js";
import { parseRssConfig } from "./config.js";
import { detectRssWorkspace } from "./detect.js";
import { rssTemplate } from "./template.js";
import { createRssApiRoutes } from "./api-routes.js";
import { rssUiSpec } from "./ui.js";
import { createDigestJob } from "./digest-job.js";

export const rssPlugin: WorkspacePlugin<RssPluginConfig> = {
  id: "rss",
  name: "RSS Reader",
  description: "AI-first RSS — digests, deep dives, and research across feeds.",

  detectWorkspace: detectRssWorkspace,

  template: rssTemplate,

  parseConfig: parseRssConfig,

  createApiRoutes(ctx) {
    return createRssApiRoutes(ctx);
  },

  startJobs(ctx) {
    return [createDigestJob(ctx)];
  },

  getAgentInstructions() {
    return rssTemplate.agentInstructions;
  },

  getUiSpec() {
    return rssUiSpec;
  },
};
