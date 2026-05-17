// PluginHost — owns the plugin lifecycle on the server side.
//
// Responsibilities:
//   1. Hold the compiled plugin module list (from registry.ts).
//   2. Build a host-global SourceRegistry from manifest contributions.
//   3. Aggregate templates from every plugin.
//   4. Resolve the active plugin for a workspace (workspaceKind | legacyDetect).
//   5. Drive activate(ctx) and DisposableStore teardown when workspaces switch.
//
// The host knows nothing plugin-specific. http.ts holds one PluginHost
// instance and consults it during boot + on every workspace open/close.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventEmitter } from "node:events";
import type { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSourceRegistry } from "@cobook/parser";
import type { SourceRegistry } from "@cobook/parser";
import type { Workspace } from "../domain/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Template } from "../templates/types.js";
import type { WorkspaceConfigFile, Manifest } from "./manifest.js";
import type { ActivationResult, JobHandle } from "./context.js";
import { buildActivateContext } from "./context.js";
import { DisposableStore } from "./disposable.js";
import {
  pluginModules,
  findPluginModule,
  defaultPluginModule,
  type PluginModule,
} from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Plugin dirs live at apps/local/plugins/<id>/. Resolved from dist/index.js up to apps/local. */
const PLUGINS_ROOT = resolve(__dirname, "..", "plugins");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolvedPlugin {
  readonly module: PluginModule;
  readonly source: "config" | "detected" | "default";
}

export interface ActiveActivation {
  readonly module: PluginModule;
  readonly config: unknown;
  readonly router: Hono | null;
  readonly jobs: ReadonlyArray<JobHandle>;
  readonly agentInstructions: string | null;
  readonly result: ActivationResult;
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

export class PluginHost {
  /** Global source provider registry — populated once at boot, shared across workspaces. */
  readonly sourceRegistry: SourceRegistry;
  /** All templates aggregated from every plugin. */
  readonly templates: readonly Template[];
  /** Current activation state, if a workspace is open. */
  private active: ActiveActivation | null = null;

  constructor() {
    this.sourceRegistry = buildSourceRegistry();
    this.templates = aggregateTemplates();
  }

  /** All known plugin manifests. */
  manifests(): readonly Manifest[] {
    return pluginModules.map((p) => p.manifest);
  }

  /** Find a template by id (used by /api/workspaces/from-template + init). */
  findTemplate(id: string): Template | undefined {
    return this.templates.find((t) => t.id === id);
  }

  /** Plugin id that ships a given template, or undefined. */
  findPluginIdForTemplate(templateId: string): string | undefined {
    for (const mod of pluginModules) {
      if (mod.templates.some((t) => t.id === templateId)) return mod.manifest.id;
    }
    return undefined;
  }

  /** Currently active plugin module, if a workspace is open. */
  activeModule(): PluginModule | null {
    return this.active?.module ?? null;
  }

  /** Plugin's HTTP sub-router for /api/plugins/<id>/*, if it registered one. */
  activeRouter(): Hono | null {
    return this.active?.router ?? null;
  }

  /** Look up a registered server-side command on the active plugin. */
  activeCommand(pluginId: string, commandId: string): import("./context.js").CommandHandler | null {
    if (!this.active || this.active.module.manifest.id !== pluginId) return null;
    return this.active.result.commands.get(commandId) ?? null;
  }

  /** Merge of plugin's prompt file + the workspace's config-level override. */
  activeAgentInstructions(): string | null {
    return this.active?.agentInstructions ?? null;
  }

  /** Pick the plugin for a workspace — explicit workspaceKind first, then legacyDetect. */
  resolvePlugin(workspace: Workspace, config: WorkspaceConfigFile): ResolvedPlugin {
    if (config.workspaceKind) {
      const mod = findPluginModule(config.workspaceKind);
      if (mod) return { module: mod, source: "config" };
      console.warn(
        `[plugin-host] unknown workspaceKind "${config.workspaceKind}", falling back to default`,
      );
      return { module: defaultPluginModule(), source: "default" };
    }

    const matches: PluginModule[] = [];
    for (const mod of pluginModules) {
      if (mod.legacyDetect?.(workspace, config)) matches.push(mod);
    }
    if (matches.length === 1) {
      console.log(`[plugin-host] auto-detected workspace kind: ${matches[0]!.manifest.id}`);
      return { module: matches[0]!, source: "detected" };
    }
    if (matches.length > 1) {
      console.warn(
        `[plugin-host] multiple plugins matched: ${matches.map((m) => m.manifest.id).join(", ")}; using default`,
      );
    }
    return { module: defaultPluginModule(), source: "default" };
  }

  /** Validate raw config against a plugin's parseConfig (if it has one). */
  parsePluginConfig(
    mod: PluginModule,
    raw: Record<string, unknown> | undefined,
  ): { ok: true; value: unknown } | { ok: false; error: string } {
    if (!mod.parseConfig) return { ok: true, value: {} };
    const result = mod.parseConfig(raw);
    if (result.ok) return { ok: true, value: result.value };
    return { ok: false, error: result.error.message };
  }

  /**
   * Activate the chosen plugin for a workspace.
   * Returns the activation handle (router + jobs); callers also read
   * `activeRouter()` later via the host.
   */
  async activate(opts: {
    module: PluginModule;
    pluginConfig: unknown;
    workspaceName: string;
    workspace: Workspace;
    providers: ProviderRegistry;
    updates: EventEmitter;
    mcpServer: McpServer | null;
  }): Promise<ActiveActivation> {
    this.deactivate();

    const { module: mod } = opts;

    const { ctx, result } = buildActivateContext({
      workspaceName: opts.workspaceName,
      pluginId: mod.manifest.id,
      config: opts.pluginConfig,
      workspace: opts.workspace,
      providers: opts.providers,
      updates: opts.updates,
      mcpServer: opts.mcpServer,
    });

    if (mod.activate) {
      try {
        await mod.activate(ctx);
      } catch (e) {
        console.error(
          `[plugin-host] activate("${mod.manifest.id}") threw: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    const agentInstructions = await resolveAgentInstructions(mod, opts.workspace);

    const active: ActiveActivation = {
      module: mod,
      config: opts.pluginConfig,
      router: result.router,
      jobs: result.jobs,
      agentInstructions,
      result,
    };
    this.active = active;
    return active;
  }

  /** Dispose the current activation. Idempotent. */
  deactivate(): void {
    if (!this.active) return;
    const { module: mod, result } = this.active;
    this.active = null;
    try {
      result.store.dispose();
    } catch (e) {
      console.warn(
        `[plugin-host] deactivate("${mod.manifest.id}") threw: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSourceRegistry(): SourceRegistry {
  const registry = new Map(createSourceRegistry());
  for (const mod of pluginModules) {
    for (const sp of mod.sourceProviders) {
      registry.set(sp.provider.name, sp.provider);
    }
  }
  return registry;
}

function aggregateTemplates(): readonly Template[] {
  const out: Template[] = [];
  for (const mod of pluginModules) {
    for (const t of mod.templates) out.push(t);
  }
  return out;
}

/**
 * Resolve the agent prompt for an active plugin.
 * Composition: plugin baseline (from manifest.agentInstructions or module export)
 *              + per-workspace override (from codoc.config.json#agentInstructions).
 *
 * Defensive dedup: workspaces scaffolded before the plugin hook landed have
 * the plugin's baseline already copied into config — treat that as no override.
 */
async function resolveAgentInstructions(
  mod: PluginModule,
  workspace: Workspace,
): Promise<string | null> {
  let pluginPart: string | null = null;

  // Prefer the precomputed export bundled by registry.ts; fall back to reading
  // manifest.agentInstructions from disk (kept for dynamic-load Phase 6).
  if (mod.agentInstructions) {
    pluginPart = mod.agentInstructions;
  } else if (mod.manifest.contributes?.agentInstructions) {
    const file = mod.manifest.contributes.agentInstructions;
    try {
      const absolute = join(PLUGINS_ROOT, mod.manifest.id, file);
      pluginPart = (await readFile(absolute, "utf-8")).trim();
    } catch {
      pluginPart = null;
    }
  }

  let configPart: string | null = null;
  try {
    const raw = await readFile(join(workspace.sourceDir, "codoc.config.json"), "utf-8");
    const cfg = JSON.parse(raw) as { agentInstructions?: string };
    if (typeof cfg.agentInstructions === "string") configPart = cfg.agentInstructions;
  } catch {
    /* no config or unreadable */
  }

  if (pluginPart && configPart && pluginPart.trim() === configPart.trim()) {
    return pluginPart;
  }
  if (pluginPart && configPart) return `${pluginPart}\n\n${configPart}`;
  return pluginPart ?? configPart;
}
