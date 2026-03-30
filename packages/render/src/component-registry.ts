import type { ResolvedComponent } from "./bundle-resolver.js";

export type ComponentMap = Record<string, ResolvedComponent>;

// --- Global registry (built-in components like CodataValue) ---

const globalRegistry = new Map<string, ResolvedComponent>();

export function registerComponent(name: string, component: ResolvedComponent): void {
  globalRegistry.set(name, component);
}

export function getComponent(name: string): ResolvedComponent | undefined {
  return globalRegistry.get(name);
}

export function getComponentMap(): ComponentMap {
  const map: ComponentMap = {};
  for (const [name, component] of globalRegistry) {
    map[name] = component;
  }
  return map;
}

export function clearComponentRegistry(): void {
  globalRegistry.clear();
}

// --- Scoped component map for a single codoc render ---

/**
 * Build a component scope for rendering a codoc's view.
 *
 * Layers (later overrides earlier):
 * 1. Global built-in components (CodataValue, etc.)
 * 2. Codoc-declared components (resolved from bundle refs)
 *
 * Only components in this scope are available in the MDX template.
 */
export function buildComponentScope(
  resolvedComponents: Record<string, ResolvedComponent>,
): ComponentMap {
  return {
    ...getComponentMap(),
    ...resolvedComponents,
  };
}
