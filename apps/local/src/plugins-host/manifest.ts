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
// Phase 3 replaced ui.primaryActions with contributes.commands + contributes.menus.
// ---------------------------------------------------------------------------

export interface WorkspaceUiViewDescriptor {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

export interface WorkspaceUiSpec {
  readonly homeView?: "tree" | "inbox";
  readonly homeCodocPath?: string;
  readonly hiddenPaths?: readonly string[];
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

// --- Phase 3: commands + menus --------------------------------------------

export interface CommandContribution {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly icon?: string;
}

export interface MenuItem {
  readonly command: string;
  /** Placeholder for future `when` clauses — host treats it as opaque metadata. */
  readonly when?: string;
  /** Placeholder for grouping inside a menu surface. */
  readonly group?: string;
}

/**
 * Menu surfaces a plugin contributes into. v1 honors `workspace.actionBar`
 * (top of the document area) and `commandPalette` (Cmd+K).
 * `view.title` and `fileTree.context` are reserved placeholders for later.
 */
export interface MenusContribution {
  readonly "workspace.actionBar"?: readonly MenuItem[];
  readonly commandPalette?: readonly MenuItem[];
  readonly "view.title"?: readonly MenuItem[];
  readonly "fileTree.context"?: readonly MenuItem[];
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
  readonly commands?: readonly CommandContribution[];
  readonly menus?: MenusContribution;

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

// ---------------------------------------------------------------------------
// Activation events (Phase 5)
//
// VS Code-style triggers that tell the host when a plugin wants to activate.
// v1 only acts on `onWorkspaceKind:<id>` (selection at workspace open).
// `onStartupFinished` is logged for observability — single-plugin-per-workspace
// keeps it from doing anything yet.
// `onCommand:<id>` is parsed but not auto-fired (would require switching the
// active plugin, which violates the one-workspace-one-plugin invariant).
// ---------------------------------------------------------------------------

export type ActivationEvent =
  | { readonly kind: "workspaceKind"; readonly id: string }
  | { readonly kind: "command"; readonly id: string }
  | { readonly kind: "startupFinished" }
  | { readonly kind: "unknown"; readonly raw: string };

/** Parse a manifest activationEvents string into an ADT. */
export function parseActivationEvent(raw: string): ActivationEvent {
  if (raw === "onStartupFinished") return { kind: "startupFinished" };
  if (raw.startsWith("onWorkspaceKind:")) {
    return { kind: "workspaceKind", id: raw.slice("onWorkspaceKind:".length) };
  }
  if (raw.startsWith("onCommand:")) {
    return { kind: "command", id: raw.slice("onCommand:".length) };
  }
  return { kind: "unknown", raw };
}

/** Parse the activationEvents array on a manifest (defaults to []). */
export function manifestActivationEvents(m: Manifest): readonly ActivationEvent[] {
  return (m.activationEvents ?? []).map(parseActivationEvent);
}
