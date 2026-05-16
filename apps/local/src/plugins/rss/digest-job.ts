// digest-job — background auto-digest with catch-up on workspace open.
//
// Lifecycle:
//   1. On startup: check if lastDigestAt is stale → refresh + digest catch-up
//   2. Periodic: setInterval at digestIntervalMinutes
//   3. On stop: clearInterval
//
// The job is registered via startJobs() in the plugin assembly. The host
// starts jobs after the first source scheduler tick completes, so articles
// are available for the initial catch-up digest.

import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import type { PluginJobHandle, WorkspacePluginContext } from "../types.js";
import type { RssPluginConfig } from "./config.js";
import { refreshFeeds, generateDigest, type RssServiceContext } from "./service.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createDigestJob(
  ctx: WorkspacePluginContext<RssPluginConfig>,
): PluginJobHandle {
  const { pluginConfig } = ctx;

  if (!pluginConfig.autoDigest) {
    return { stop() {} };
  }

  const svcCtx: RssServiceContext = {
    workspace: ctx.workspace,
    updates: ctx.updates,
    pluginConfig: ctx.pluginConfig,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      console.log("[digest-job] running scheduled digest");
      await refreshFeeds(svcCtx);
      await generateDigest(svcCtx);
      console.log("[digest-job] scheduled digest complete");
    } catch (e) {
      console.warn(
        `[digest-job] digest failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Catch-up: if lastDigestAt is stale, run immediately.
  const catchUp = (async () => {
    if (stopped) return;

    const stale = isDigestStale(svcCtx, pluginConfig.digestIntervalMinutes);
    if (stale) {
      console.log("[digest-job] digest is stale, running catch-up");
      await tick();
    } else {
      console.log("[digest-job] digest is fresh, skipping catch-up");
    }

    // Start periodic timer.
    if (!stopped) {
      const intervalMs = pluginConfig.digestIntervalMinutes * 60 * 1000;
      timer = setInterval(() => void tick(), intervalMs);
      console.log(
        `[digest-job] scheduled every ${pluginConfig.digestIntervalMinutes}m`,
      );
    }
  })();

  return {
    ready: catchUp,
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log("[digest-job] stopped");
    },
  };
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

function isDigestStale(ctx: RssServiceContext, intervalMinutes: number): boolean {
  const { workspace: ws, pluginConfig } = ctx;
  const inboxPath = mkCodocPath(pluginConfig.digestCodocPath);
  const inbox = ws.codocs.get(inboxPath);
  if (!inbox) return true;

  const field = inbox.ast.data.get(mkFieldName("lastDigestAt"));
  if (!field || field.kind !== "static" || !field.value) return true;

  const lastDigest = new Date(field.value as string).getTime();
  if (isNaN(lastDigest)) return true;

  const elapsed = Date.now() - lastDigest;
  return elapsed >= intervalMinutes * 60 * 1000;
}
