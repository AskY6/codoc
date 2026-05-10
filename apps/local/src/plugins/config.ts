// Plugin config — parse raw codoc.config.json into typed config layers.

import type {
  WorkspaceConfigFile,
  HostWorkspaceConfig,
  LegacyInteractionHints,
} from "./types.js";

/**
 * Parse raw JSON from codoc.config.json into a typed WorkspaceConfigFile.
 * Unknown fields are preserved for forward compatibility.
 */
export function parseWorkspaceConfig(
  raw: Record<string, unknown>,
): WorkspaceConfigFile {
  const config: WorkspaceConfigFile = {};

  // Host-level fields
  if (typeof raw.port === "number") config.port = raw.port;
  if (typeof raw.workspaceKind === "string") config.workspaceKind = raw.workspaceKind;
  if (raw.pluginConfig != null && typeof raw.pluginConfig === "object" && !Array.isArray(raw.pluginConfig)) {
    config.pluginConfig = raw.pluginConfig as Record<string, unknown>;
  }

  // Legacy interaction hints
  if (Array.isArray(raw.commands)) {
    config.commands = raw.commands as Array<{ name: string; description: string; prompt: string }>;
  }
  if (Array.isArray(raw.quickActions)) {
    config.quickActions = raw.quickActions as Array<{ label: string; prompt: string }>;
  }
  if (typeof raw.agentInstructions === "string") config.agentInstructions = raw.agentInstructions;

  return config;
}

/**
 * Extract the workspaceKind from a parsed config.
 * Returns undefined when not set (legacy workspace).
 */
export function getWorkspaceKind(config: WorkspaceConfigFile): string | undefined {
  return config.workspaceKind;
}
