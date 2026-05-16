// Plugin registry — built-in workspace plugins, looked up by workspaceKind.

import type { WorkspacePlugin } from "./types.js";
import { defaultPlugin } from "../../plugins/default/server/index.js";
import { rssPlugin } from "../../plugins/rss/server/index.js";

/** All built-in plugins, ordered by detection priority. */
const plugins: readonly WorkspacePlugin[] = [
  rssPlugin,
  defaultPlugin,
];

/** Look up a plugin by its id (= workspaceKind). */
export function findPlugin(id: string): WorkspacePlugin | undefined {
  return plugins.find((p) => p.id === id);
}

/** Get all registered plugins. */
export function allPlugins(): readonly WorkspacePlugin[] {
  return plugins;
}

/** Get the default plugin (always exists). */
export function getDefaultPlugin(): WorkspacePlugin {
  return defaultPlugin;
}
