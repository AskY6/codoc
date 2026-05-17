// Compile-time plugin registry.
//
// Each manifest's `entry` pointers (e.g. "server/sources.ts#rssProvider")
// are *documentation* in v1 — actual resolution happens here via direct
// static imports. tsup walks these imports and bundles each plugin module
// into the main artifact. Phase 6 (third-party distribution) replaces this
// file with a manifest-driven dynamic-import loader.

import type { Manifest } from "./manifest.js";
import type { ActivateContext } from "./context.js";
import type { Disposable } from "./disposable.js";
import type { SourceProvider } from "@cobook/parser";
import type { Workspace } from "../domain/types.js";
import type { Template } from "../templates/types.js";
import type { Result } from "@cobook/core";
import type { WorkspaceConfigFile, PluginConfigError } from "./manifest.js";

// Manifests --------------------------------------------------------------

import rssManifest from "../../plugins/rss/manifest.json" with { type: "json" };
import bookmarksManifest from "../../plugins/bookmarks/manifest.json" with { type: "json" };
import defaultManifest from "../../plugins/default/manifest.json" with { type: "json" };

// Plugin module bindings -------------------------------------------------
//
// We import the live objects pointed at by manifest entry strings.

import {
  activate as rssActivate,
  rssProvider,
  parseRssConfig,
  detectRssWorkspace,
  rssTemplate,
  rssAgentInstructions,
} from "../../plugins/rss/server/index.js";
import { bookmarksTemplate } from "../../plugins/bookmarks/template/index.js";
import { activate as defaultActivate } from "../../plugins/default/server/index.js";

// ---------------------------------------------------------------------------
// Resolved entry types
// ---------------------------------------------------------------------------

export type ActivateFn = (ctx: ActivateContext<unknown>) => void | Promise<void>;
export type DetectFn = (ws: Workspace, config: WorkspaceConfigFile) => boolean;
export type ParseConfigFn = (
  raw: Record<string, unknown> | undefined,
) => Result<unknown, PluginConfigError>;

/** Compile-time bundle of a plugin's manifest + resolved entry pointers. */
export interface PluginModule {
  readonly manifest: Manifest;
  readonly activate: ActivateFn | null;
  readonly sourceProviders: ReadonlyArray<{ scheme: string; provider: SourceProvider }>;
  readonly templates: ReadonlyArray<Template>;
  readonly legacyDetect: DetectFn | null;
  readonly parseConfig: ParseConfigFn | null;
  readonly agentInstructions: string | null;
}

// ---------------------------------------------------------------------------
// Static module list
// ---------------------------------------------------------------------------

export const pluginModules: readonly PluginModule[] = [
  {
    manifest: rssManifest as Manifest,
    activate: rssActivate as ActivateFn,
    sourceProviders: [{ scheme: "rss", provider: rssProvider }],
    templates: [rssTemplate],
    legacyDetect: detectRssWorkspace,
    parseConfig: parseRssConfig as ParseConfigFn,
    agentInstructions: rssAgentInstructions,
  },
  {
    manifest: bookmarksManifest as Manifest,
    activate: null,
    sourceProviders: [],
    templates: [bookmarksTemplate],
    legacyDetect: null,
    parseConfig: null,
    agentInstructions: null,
  },
  {
    manifest: defaultManifest as Manifest,
    activate: defaultActivate as ActivateFn,
    sourceProviders: [],
    templates: [],
    legacyDetect: null,
    parseConfig: null,
    agentInstructions: null,
  },
];

/** Find a plugin module by id. */
export function findPluginModule(id: string): PluginModule | undefined {
  return pluginModules.find((p) => p.manifest.id === id);
}

/** The default fallback module (no-op runtime). */
export function defaultPluginModule(): PluginModule {
  const mod = findPluginModule("default");
  if (!mod) throw new Error("[plugin-host] default plugin module missing");
  return mod;
}
