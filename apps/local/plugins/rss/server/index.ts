// RSS plugin — vertical workspace capability pack for RSS reading.
//
// Owns: rss source provider, template, config, detection, article state API,
//       digest job, agent instructions.
// Does NOT own: source scheduler (platform).
//
// Phase 2 contract: the host imports this file's named exports per the
// `entry` pointers declared in manifest.json. `activate(ctx)` is the
// per-workspace lifecycle entry — it mounts API routes and starts the
// digest job through `ctx.routes` / `ctx.jobs`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivateContext } from "../../../src/plugins-host/context.js";
import type { RssPluginConfig } from "./config.js";
import { createRssApiRoutes } from "./api-routes.js";
import { createDigestJob } from "./digest-job.js";
import type { RssServiceContext } from "./service.js";

// ---- Static contributions (resolved by plugins-host/registry.ts) ----------

export { rssProvider } from "./source-provider.js";
export type { RssArticle } from "./source-provider.js";
export { parseRssConfig } from "./config.js";
export type { RssPluginConfig } from "./config.js";
export { detectRssWorkspace } from "./detect.js";
export { rssTemplate } from "../template/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Long-form agent prompt, loaded once at module init from agent-prompt.md. */
export const rssAgentInstructions: string = (() => {
  try {
    return readFileSync(join(__dirname, "..", "agent-prompt.md"), "utf-8").trim();
  } catch {
    return "";
  }
})();

// ---- activate(ctx) — per-workspace lifecycle ------------------------------

export function activate(ctx: ActivateContext<RssPluginConfig>): void {
  const svcCtx: RssServiceContext = {
    workspace: ctx.workspace,
    updates: ctx.updates,
    pluginConfig: ctx.config,
  };

  ctx.routes.use(createRssApiRoutes(svcCtx));

  ctx.jobs.start("rss-digest", () => createDigestJob(svcCtx));
}
