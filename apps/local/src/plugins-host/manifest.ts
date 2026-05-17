// Manifest — declarative plugin metadata + contribution points.
//
// Each plugin ships `manifest.json` next to its server/ui code. The host
// reads manifests at boot, registers static contributions (sourceProviders,
// templates, legacyDetect, configurationSchema, agentInstructions) before
// loading any workspace, then later invokes `activate(ctx)` for the
// workspace's selected plugin.

// ---------------------------------------------------------------------------
// Workspace config file (was apps/local/src/plugins/types.ts)
// ---------------------------------------------------------------------------

export interface HostWorkspaceConfig {
  port?: number;
  workspaceKind?: string;
  pluginConfig?: Record<string, unknown>;
}

/** @deprecated Legacy interaction hints — kept for backward-compat with templates that seed them. */
export interface LegacyInteractionHints {
  commands?: Array<{ name: string; description: string; prompt: string }>;
  quickActions?: Array<{ label: string; prompt: string }>;
  agentInstructions?: string;
}

export type WorkspaceConfigFile = HostWorkspaceConfig & LegacyInteractionHints;

/**
 * Parse raw JSON from codoc.config.json into a typed WorkspaceConfigFile.
 * Unknown fields are preserved for forward compatibility.
 */
export function parseWorkspaceConfig(
  raw: Record<string, unknown>,
): WorkspaceConfigFile {
  const config: WorkspaceConfigFile = {};

  if (typeof raw.port === "number") config.port = raw.port;
  if (typeof raw.workspaceKind === "string") config.workspaceKind = raw.workspaceKind;
  if (
    raw.pluginConfig != null &&
    typeof raw.pluginConfig === "object" &&
    !Array.isArray(raw.pluginConfig)
  ) {
    config.pluginConfig = raw.pluginConfig as Record<string, unknown>;
  }

  if (Array.isArray(raw.commands)) {
    config.commands = raw.commands as Array<{ name: string; description: string; prompt: string }>;
  }
  if (Array.isArray(raw.quickActions)) {
    config.quickActions = raw.quickActions as Array<{ label: string; prompt: string }>;
  }
  if (typeof raw.agentInstructions === "string") config.agentInstructions = raw.agentInstructions;

  return config;
}

// ---------------------------------------------------------------------------
// Plugin config error (was apps/local/src/plugins/types.ts)
// ---------------------------------------------------------------------------

export interface PluginConfigError {
  readonly kind: "invalid-plugin-config";
  readonly pluginId: string;
  readonly message: string;
  readonly issues?: readonly string[];
}

// ---------------------------------------------------------------------------
// UI descriptor types — surfaced verbatim through /api/workspace.
// Phase 3 replaces primaryActions with manifest.contributes.commands + menus.
// ---------------------------------------------------------------------------

export type WorkspaceUiActionDescriptor =
  | {
      readonly kind: "rest";
      readonly id: string;
      readonly label: string;
      readonly method: "GET" | "POST" | "PATCH" | "DELETE";
      readonly path: string;
    }
  | {
      readonly kind: "chat-prompt";
      readonly id: string;
      readonly label: string;
      readonly prompt: string;
    };

export interface WorkspaceUiViewDescriptor {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

export interface WorkspaceUiSpec {
  readonly homeView?: "tree" | "inbox";
  readonly homeCodocPath?: string;
  readonly hiddenPaths?: readonly string[];
  readonly primaryActions?: readonly WorkspaceUiActionDescriptor[];
  readonly secondaryViews?: readonly WorkspaceUiViewDescriptor[];
}

// ---------------------------------------------------------------------------
// Manifest schema (JSON shape)
// ---------------------------------------------------------------------------

/**
 * Pointer to a module export within a plugin directory.
 * v1 resolves these at compile time via plugins-host/registry.ts —
 * the string form is kept for documentation + future dynamic loading.
 */
export type EntryPointer = string; // "path/to/file.ts" or "path/to/file.ts#exportName"

export interface SourceProviderContribution {
  readonly scheme: string;
  readonly entry: EntryPointer;
}

export interface TemplateContribution {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly entry: EntryPointer;
}

export interface LegacyDetectContribution {
  readonly entry: EntryPointer;
}

export interface McpToolContribution {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for tool input (forwarded to MCP). */
  readonly inputSchema?: Record<string, unknown>;
}

export interface ViewContribution {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

export interface MdxComponentContribution {
  readonly name: string;
  readonly path: string;
}

export interface ManifestContributes {
  // --- Static (registered before workspace load) -----------------------
  readonly sourceProviders?: readonly SourceProviderContribution[];
  readonly templates?: readonly TemplateContribution[];
  readonly legacyDetect?: LegacyDetectContribution;
  readonly configurationSchema?: Record<string, unknown>;
  /** Path (relative to plugin dir) to an agent prompt markdown file. */
  readonly agentInstructions?: string;

  // --- Activation (declarative — programmatic half in activate(ctx)) ---
  readonly mcpTools?: readonly McpToolContribution[];

  // --- UI (consumed by SPA via /api/workspace) -------------------------
  readonly views?: readonly ViewContribution[];
  readonly mdxComponents?: readonly MdxComponentContribution[];
  readonly ui?: WorkspaceUiSpec;
}

export interface Manifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly engines?: { readonly codoc?: string };
  readonly activationEvents?: readonly string[];
  readonly contributes?: ManifestContributes;
}
