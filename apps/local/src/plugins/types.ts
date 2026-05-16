// WorkspacePlugin — interface for vertical workspace capability packs.
//
// A plugin owns domain-specific runtime: source providers, API routes,
// MCP tools, background jobs, agent prompt contribution, and UI hints.
// Platform capabilities (codoc CRUD, source scheduler, DAG) stay in the host.

import type { EventEmitter } from "node:events";
import type { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Workspace } from "../workspace/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Template } from "../templates/types.js";
import type { SourceProvider } from "@cobook/parser";
import type { Result } from "@cobook/core";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface HostWorkspaceConfig {
  port?: number;
  workspaceKind?: string;
  pluginConfig?: Record<string, unknown>;
}

/** @deprecated Legacy interaction hints — prefer plugin-defined runtime. */
export interface LegacyInteractionHints {
  commands?: Array<{ name: string; description: string; prompt: string }>;
  quickActions?: Array<{ label: string; prompt: string }>;
  agentInstructions?: string;
}

export type WorkspaceConfigFile =
  & HostWorkspaceConfig
  & LegacyInteractionHints;

// ---------------------------------------------------------------------------
// Plugin config error
// ---------------------------------------------------------------------------

export interface PluginConfigError {
  readonly kind: "invalid-plugin-config";
  readonly pluginId: string;
  readonly message: string;
  readonly issues?: readonly string[];
}

// ---------------------------------------------------------------------------
// Plugin context — passed to all runtime hooks
// ---------------------------------------------------------------------------

export interface WorkspacePluginContext<C = unknown> {
  readonly workspaceName: string;
  readonly workspace: Workspace;
  readonly config: WorkspaceConfigFile;
  readonly pluginConfig: C;
  readonly updates: EventEmitter;
  readonly providerRegistry: ProviderRegistry;
}

// ---------------------------------------------------------------------------
// Plugin job handle
// ---------------------------------------------------------------------------

export interface PluginJobHandle {
  readonly ready?: Promise<void>;
  stop(): void;
}

// ---------------------------------------------------------------------------
// UI descriptor
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
  /** Codoc path to auto-focus on first workspace load. Takes precedence over homeView. */
  readonly homeCodocPath?: string;
  readonly hiddenPaths?: readonly string[];
  readonly primaryActions?: readonly WorkspaceUiActionDescriptor[];
  readonly secondaryViews?: readonly WorkspaceUiViewDescriptor[];
}

// ---------------------------------------------------------------------------
// WorkspacePlugin
// ---------------------------------------------------------------------------

export interface WorkspacePlugin<C = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  /** Detect whether a legacy workspace (no workspaceKind) belongs to this plugin. */
  detectWorkspace?(workspace: Workspace, config: WorkspaceConfigFile): boolean;

  /** Scaffold template for `codoc init --from`. */
  readonly template?: Template;

  /** Parse raw pluginConfig JSON into typed config. */
  parseConfig(
    raw: Record<string, unknown> | undefined,
  ): Result<C, PluginConfigError>;

  /** Source providers contributed by this plugin. */
  sourceProviders?(): readonly SourceProvider[];

  /** REST routes mounted under /api/plugins/<plugin-id>. */
  createApiRoutes?(ctx: WorkspacePluginContext<C>): Hono;

  /** Extra MCP tools appended to the shared MCP server. */
  registerMcpTools?(server: McpServer, ctx: WorkspacePluginContext<C>): void;

  /** Plugin-specific background jobs. */
  startJobs?(ctx: WorkspacePluginContext<C>): readonly PluginJobHandle[];

  /** Extra system prompt for local chat providers. */
  getAgentInstructions?(ctx: WorkspacePluginContext<C>): string | undefined;

  /** UI hints for local SPA. */
  getUiSpec?(ctx: WorkspacePluginContext<C>): WorkspaceUiSpec;
}
