// Component registry for MDX view templates.
// Maps component names to their implementations for use in rendered views.

export type ComponentMap = Record<string, unknown>;

const registry = new Map<string, unknown>();

export function registerComponent(name: string, component: unknown): void {
  registry.set(name, component);
}

export function getComponent(name: string): unknown | undefined {
  return registry.get(name);
}

export function getComponentMap(): ComponentMap {
  const map: ComponentMap = {};
  for (const [name, component] of registry) {
    map[name] = component;
  }
  return map;
}

export function clearComponentRegistry(): void {
  registry.clear();
}
