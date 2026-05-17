// Static lookups against the compile-time plugin registry.
//
// Useful for CLI commands like `codoc init` that need plugin metadata but
// don't want to spin up a full PluginHost.

import { pluginModules, findPluginModule } from "./registry.js";
import type { Template } from "../templates/types.js";

/** Plugin id that ships a template with this id, or undefined. */
export function findPluginIdForTemplate(templateId: string): string | undefined {
  for (const mod of pluginModules) {
    if (mod.templates.some((t) => t.id === templateId)) return mod.manifest.id;
  }
  return undefined;
}

/** MDX component names contributed by a plugin via manifest.mdxComponents. */
export function mdxComponentNamesForPlugin(pluginId: string): readonly string[] {
  const mod = findPluginModule(pluginId);
  return mod?.manifest.contributes?.mdxComponents?.map((c) => c.name) ?? [];
}

/** All templates contributed by every plugin (host-global view). */
export function allTemplates(): readonly Template[] {
  const out: Template[] = [];
  for (const mod of pluginModules) {
    for (const t of mod.templates) out.push(t);
  }
  return out;
}

/** Look up a template by id across every plugin. */
export function findTemplate(id: string): Template | undefined {
  return allTemplates().find((t) => t.id === id);
}
