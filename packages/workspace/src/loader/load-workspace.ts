import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseCodocText,
  parseComponentRegistryText,
  type ComponentSpec,
  type ParsedCodoc
} from "@cobook/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { loadCobookConfig, parseAgents, parseSources } from "../config/load-cobook-config.js";
import { scanCodocFiles } from "../scanner/scan-codoc-files.js";

import type { LoadedWorkspace, CodocSummary, WorkspaceSnapshot } from "./types.js";
import type { CobookConfig } from "../config/types.js";

interface PluginContributions {
  agents: NonNullable<CobookConfig["agents"]>;
  sources: NonNullable<CobookConfig["sources"]>;
  components: Record<string, ComponentSpec>;
}

export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const baseConfig = await loadCobookConfig(root);
  const pluginContributions = await loadWorkspacePlugins(root, baseConfig.plugins ?? []);
  const config = mergeConfigWithPlugins(baseConfig, pluginContributions);
  const codocPaths = await scanCodocFiles(root, config);
  const codocs = new Map<string, ParsedCodoc>();
  const componentRegistry = await loadComponentRegistry(root, config, pluginContributions.components);

  for (const relativePath of codocPaths) {
    const raw = await readFile(join(root, relativePath), "utf8");
    const codoc = parseCodocText(relativePath, raw);

    if (codocs.has(codoc.id)) {
      throw new Error(`Duplicate codoc id "${codoc.id}" found in workspace.`);
    }

    codocs.set(codoc.id, codoc);
  }

  return {
    root,
    config,
    codocs,
    componentRegistry
  };
}

export function summarizeCodoc(codoc: ParsedCodoc): CodocSummary {
  return {
    id: codoc.id,
    filePath: codoc.filePath,
    hasData: codoc.data !== undefined,
    hasView: codoc.view !== undefined,
    hasComponents: codoc.component !== undefined
  };
}

export function toWorkspaceSnapshot(workspace: LoadedWorkspace): WorkspaceSnapshot {
  return {
    root: workspace.root,
    config: workspace.config,
    codocs: Array.from(workspace.codocs.values()).map(summarizeCodoc),
    componentRegistry: workspace.componentRegistry
  };
}

async function loadComponentRegistry(
  root: string,
  config: LoadedWorkspace["config"],
  pluginComponents: Record<string, ComponentSpec>
): Promise<Record<string, ComponentSpec>> {
  if (!config.components?.$ref) {
    return pluginComponents;
  }

  const filePath = config.components.$ref.replace(/^\.\//, "");
  const raw = await readFile(join(root, filePath), "utf8");
  return {
    ...pluginComponents,
    ...parseComponentRegistryText(filePath, raw)
  };
}

async function loadWorkspacePlugins(root: string, plugins: string[]): Promise<PluginContributions> {
  const contributions: PluginContributions = {
    agents: {},
    sources: {},
    components: {}
  };

  for (const pluginPath of plugins) {
    const normalizedPath = pluginPath.replace(/^\.\//, "");
    const raw = await readFile(join(root, normalizedPath), "utf8");
    const parsed = parseYaml(raw);

    if (!isRecord(parsed)) {
      throw new Error(`Plugin manifest "${normalizedPath}" must parse to an object.`);
    }

    if (typeof parsed.cobookPlugin !== "string") {
      throw new Error(`Plugin manifest "${normalizedPath}" must include string field "cobookPlugin".`);
    }

    contributions.agents = {
      ...contributions.agents,
      ...(parsed.agents !== undefined ? parseAgents(parsed.agents, normalizedPath) : {})
    };
    contributions.sources = {
      ...contributions.sources,
      ...(parsed.sources !== undefined ? parseSources(parsed.sources, normalizedPath) : {})
    };
    contributions.components = {
      ...contributions.components,
      ...(parsed.components !== undefined
        ? parseComponentRegistryText(
            `${normalizedPath}#/components`,
            stringifyYaml(parsed.components, {
              lineWidth: 0
            })
          )
        : {})
    };
  }

  return contributions;
}

function mergeConfigWithPlugins(
  config: CobookConfig,
  plugins: PluginContributions
): CobookConfig {
  return {
    ...config,
    ...(Object.keys(plugins.agents).length > 0 || config.agents
      ? {
          agents: {
            ...plugins.agents,
            ...(config.agents ?? {})
          }
        }
      : {}),
    ...(Object.keys(plugins.sources).length > 0 || config.sources
      ? {
          sources: {
            ...plugins.sources,
            ...(config.sources ?? {})
          }
        }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
