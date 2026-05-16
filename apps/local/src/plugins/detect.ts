// Plugin detection — resolve the active plugin for a workspace.
//
// Strategy:
// 1. If workspaceKind is set in config, look up directly.
// 2. Otherwise, try each plugin's detectWorkspace() in registry order.
// 3. Exactly one match → activate it. Zero or multiple → fallback to default.

import type { Workspace } from "../workspace/index.js";
import type { WorkspacePlugin, WorkspaceConfigFile } from "./types.js";
import { findPlugin, allPlugins, getDefaultPlugin } from "./registry.js";

/**
 * Resolve the active plugin for a workspace.
 * Returns the plugin and whether it was explicitly configured vs auto-detected.
 */
export function resolvePlugin(
  workspace: Workspace,
  config: WorkspaceConfigFile,
): { plugin: WorkspacePlugin; source: "config" | "detected" | "default" } {
  // Explicit workspaceKind in config
  if (config.workspaceKind) {
    const plugin = findPlugin(config.workspaceKind);
    if (plugin) {
      return { plugin, source: "config" };
    }
    console.warn(
      `[plugin] unknown workspaceKind "${config.workspaceKind}", falling back to default`,
    );
    return { plugin: getDefaultPlugin(), source: "default" };
  }

  // Auto-detect from workspace content
  const matches: WorkspacePlugin[] = [];
  for (const plugin of allPlugins()) {
    if (plugin.detectWorkspace?.(workspace, config)) {
      matches.push(plugin);
    }
  }

  if (matches.length === 1) {
    console.log(`[plugin] auto-detected workspace kind: ${matches[0]!.id}`);
    return { plugin: matches[0]!, source: "detected" };
  }

  if (matches.length > 1) {
    console.warn(
      `[plugin] multiple plugins matched: ${matches.map((p) => p.id).join(", ")}; falling back to default`,
    );
  }

  return { plugin: getDefaultPlugin(), source: "default" };
}
