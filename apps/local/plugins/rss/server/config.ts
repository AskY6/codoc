// RSS plugin config — typed schema for pluginConfig.rss.

import { ok, err } from "@cobook/core";
import type { Result } from "@cobook/core";
import type { PluginConfigError } from "../../../src/plugins-host/manifest.js";

export interface RssPluginConfig {
  readonly defaultSourceIntervalMinutes: number;
  readonly digestCodocPath: string;
  readonly sourcesDir: string;
  readonly autoDigest: boolean;
  readonly digestIntervalMinutes: number;
}

const DEFAULTS: RssPluginConfig = {
  defaultSourceIntervalMinutes: 30,
  digestCodocPath: "inbox.codoc",
  sourcesDir: "sources",
  autoDigest: true,
  digestIntervalMinutes: 120,
};

export function parseRssConfig(
  raw: Record<string, unknown> | undefined,
): Result<RssPluginConfig, PluginConfigError> {
  if (!raw) return ok({ ...DEFAULTS });

  const issues: string[] = [];

  const interval = raw.defaultSourceIntervalMinutes;
  if (interval !== undefined && (typeof interval !== "number" || interval <= 0)) {
    issues.push("defaultSourceIntervalMinutes must be a positive number");
  }

  const digestPath = raw.digestCodocPath;
  if (digestPath !== undefined && typeof digestPath !== "string") {
    issues.push("digestCodocPath must be a string");
  }

  const sourcesDir = raw.sourcesDir;
  if (sourcesDir !== undefined && typeof sourcesDir !== "string") {
    issues.push("sourcesDir must be a string");
  }

  const autoDigest = raw.autoDigest;
  if (autoDigest !== undefined && typeof autoDigest !== "boolean") {
    issues.push("autoDigest must be a boolean");
  }

  const digestInterval = raw.digestIntervalMinutes;
  if (digestInterval !== undefined && (typeof digestInterval !== "number" || digestInterval <= 0)) {
    issues.push("digestIntervalMinutes must be a positive number");
  }

  if (issues.length > 0) {
    return err({
      kind: "invalid-plugin-config",
      pluginId: "rss",
      message: `Invalid RSS plugin config: ${issues.join("; ")}`,
      issues,
    });
  }

  return ok({
    defaultSourceIntervalMinutes:
      typeof interval === "number" ? interval : DEFAULTS.defaultSourceIntervalMinutes,
    digestCodocPath:
      typeof digestPath === "string" ? digestPath : DEFAULTS.digestCodocPath,
    sourcesDir:
      typeof sourcesDir === "string" ? sourcesDir : DEFAULTS.sourcesDir,
    autoDigest:
      typeof autoDigest === "boolean" ? autoDigest : DEFAULTS.autoDigest,
    digestIntervalMinutes:
      typeof digestInterval === "number" ? digestInterval : DEFAULTS.digestIntervalMinutes,
  });
}
