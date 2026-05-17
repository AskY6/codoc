// custom-components — fetches, evaluates, and merges custom .tsx components
// from the server into the built-in component registry.
//
// Server compiles .tsx → CJS with react externalized. We evaluate the CJS
// using a mock require() that resolves react from the app's loaded modules.
//
// Component priority (lowest → highest):
//   builtin → plugin-shipped → user .codoc/components/
// User wins on collisions so legacy workspaces with scaffolded copies keep
// working; we just warn in the console.

import { useState, useEffect, type ComponentType } from "react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { api } from "./api.ts";
import type { CustomComponentEntry } from "./api.ts";
import {
  registry as builtinRegistry,
  componentMap as builtinComponentMap,
} from "./components/builtin/index.ts";
import type { ComponentMeta, RegisteredComponent } from "./components/builtin/index.ts";

// ---------------------------------------------------------------------------
// CJS evaluator
// ---------------------------------------------------------------------------

const moduleMap: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react/jsx-dev-runtime": jsxRuntime,
};

interface EvaluatedComponent {
  component: ComponentType<Record<string, unknown>>;
  meta: ComponentMeta;
}

function evaluateCJS(name: string, code: string): EvaluatedComponent | null {
  const mockRequire = (mod: string): unknown => {
    const resolved = moduleMap[mod];
    if (resolved) return resolved;
    throw new Error(`Cannot require "${mod}" in custom component "${name}"`);
  };

  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  const fn = new Function("require", "module", "exports", code);
  fn(mockRequire, module, module.exports);

  const exports = module.exports;

  // Find the component: default export, or named export matching the filename
  const component = (
    exports.default ?? exports[name]
  ) as ComponentType<Record<string, unknown>> | undefined;

  if (typeof component !== "function") return null;

  // Extract meta if exported, otherwise generate minimal metadata
  const rawMeta = exports.meta as Partial<ComponentMeta> | undefined;
  const meta: ComponentMeta = {
    name,
    description: rawMeta?.description ?? "Custom component",
    props: rawMeta?.props ?? [],
    template: rawMeta?.template ?? `<${name} />`,
    dataTypeHints: rawMeta?.dataTypeHints ?? [],
  };

  return { component, meta };
}

// ---------------------------------------------------------------------------
// Hook: useCustomComponents
// ---------------------------------------------------------------------------

export interface PluginComponentEntry {
  readonly name: string;
  readonly component: ComponentType<Record<string, unknown>>;
}

export interface MergedComponents {
  /** Built-in component registry */
  readonly builtinRegistry: readonly RegisteredComponent[];
  /** Plugin-shipped components (from activateUi) */
  readonly pluginRegistry: readonly PluginComponentEntry[];
  /** Custom component registry (loaded from .codoc/components/) */
  readonly customRegistry: readonly RegisteredComponent[];
  /** builtin + plugin + custom map for MDX injection (custom wins on collisions) */
  readonly componentMap: Record<string, ComponentType<Record<string, unknown>>>;
  /** Any custom components that failed to compile or evaluate */
  readonly errors: Array<{ name: string; error: string }>;
}

interface UseCustomComponentsOptions {
  /** Re-fetch trigger for /api/components (e.g. workspace SSE update). */
  readonly refreshKey: unknown;
  /** Plugin-shipped component map (from UiPluginHost). */
  readonly pluginComponents?: Record<string, ComponentType<Record<string, unknown>>>;
}

/**
 * Fetches custom components from the server, evaluates them, and merges the
 * three layers (builtin → plugin → user) into a single component map for MDX
 * rendering.
 */
export function useCustomComponents(opts: UseCustomComponentsOptions): MergedComponents {
  const pluginComponents = opts.pluginComponents ?? EMPTY_PLUGIN_MAP;
  const [serverState, setServerState] = useState<{
    customRegistry: readonly RegisteredComponent[];
    customMap: Record<string, ComponentType<Record<string, unknown>>>;
    errors: Array<{ name: string; error: string }>;
  }>(() => ({ customRegistry: [], customMap: {}, errors: [] }));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let entries: CustomComponentEntry[];
      try {
        entries = await api.components();
      } catch {
        // API not available — use builtins/plugin only
        return;
      }

      if (cancelled) return;

      const customRegistry: RegisteredComponent[] = [];
      const customMap: Record<string, ComponentType<Record<string, unknown>>> = {};
      const errors: Array<{ name: string; error: string }> = [];

      for (const entry of entries) {
        if (entry.kind === "error") {
          errors.push({ name: entry.name, error: entry.error });
          continue;
        }

        try {
          const result = evaluateCJS(entry.name, entry.code);
          if (result) {
            customRegistry.push(result);
            customMap[result.meta.name] = result.component;
          } else {
            errors.push({
              name: entry.name,
              error: "No component function found in exports",
            });
          }
        } catch (e) {
          errors.push({
            name: entry.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (!cancelled) setServerState({ customRegistry, customMap, errors });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [opts.refreshKey]);

  // Warn when a user-scaffolded component shadows a plugin-shipped one.
  useEffect(() => {
    for (const name of Object.keys(serverState.customMap)) {
      if (pluginComponents[name]) {
        console.warn(
          `[components] user component "${name}" shadows the plugin-shipped version. ` +
          `Delete .codoc/<workspace>/components/${name}.tsx to use the latest from the plugin.`,
        );
      }
    }
  }, [serverState.customMap, pluginComponents]);

  const pluginRegistry: PluginComponentEntry[] = Object.entries(pluginComponents).map(
    ([name, component]) => ({ name, component }),
  );

  return {
    builtinRegistry,
    pluginRegistry,
    customRegistry: serverState.customRegistry,
    componentMap: {
      ...builtinComponentMap,
      ...pluginComponents,
      ...serverState.customMap,
    },
    errors: serverState.errors,
  };
}

const EMPTY_PLUGIN_MAP: Record<string, ComponentType<Record<string, unknown>>> = {};
