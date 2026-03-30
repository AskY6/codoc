import type {
  ComponentSignature,
  ComponentsMeta,
  ComponentRef,
} from "@codoc/core";

export interface WorkspaceComponent {
  name: string;
  signature: ComponentSignature;
  bundle: ComponentRef;
}

/**
 * Workspace-level shared component library.
 *
 * Components registered here are the source of truth for signature + bundle.
 * Codocs reference workspace components via `{ from: "workspace://lib/Name" }`,
 * and their meta.components is auto-inherited from this library.
 */
export class ComponentLibrary {
  private components = new Map<string, WorkspaceComponent>();
  private listeners = new Set<() => void>();

  register(component: WorkspaceComponent): void {
    this.components.set(component.name, component);
    this.notify();
  }

  unregister(name: string): boolean {
    const deleted = this.components.delete(name);
    if (deleted) this.notify();
    return deleted;
  }

  get(name: string): WorkspaceComponent | undefined {
    return this.components.get(name);
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  list(): WorkspaceComponent[] {
    return [...this.components.values()];
  }

  /**
   * Get the signatures map (ComponentsMeta format) for all registered components.
   */
  getSignatures(): ComponentsMeta {
    const result: ComponentsMeta = {};
    for (const [name, comp] of this.components) {
      result[name] = comp.signature;
    }
    return result;
  }

  /**
   * Resolve the signature for a workspace:// reference.
   * Returns undefined if the component is not in the library.
   */
  resolveSignature(fromRef: string): ComponentSignature | undefined {
    // fromRef format: "workspace://lib-name/ComponentName"
    const match = fromRef.match(/^workspace:\/\/[^/]+\/(.+)$/);
    if (!match) return undefined;
    return this.components.get(match[1])?.signature;
  }

  /**
   * Resolve the full component for a workspace:// reference.
   */
  resolveComponent(fromRef: string): WorkspaceComponent | undefined {
    const match = fromRef.match(/^workspace:\/\/[^/]+\/(.+)$/);
    if (!match) return undefined;
    return this.components.get(match[1]);
  }

  /**
   * Build the effective ComponentsMeta for a codoc, inheriting
   * signatures from the workspace library for workspace:// refs.
   */
  resolveEffectiveMeta(
    declaredMeta: ComponentsMeta | undefined,
    componentsBody: Record<string, { ref: ComponentRef }> | undefined,
  ): ComponentsMeta {
    const result: ComponentsMeta = { ...declaredMeta };

    if (!componentsBody) return result;

    for (const [name, decl] of Object.entries(componentsBody)) {
      // Already has explicit meta — don't override
      if (result[name]) continue;

      if ("from" in decl.ref) {
        const inherited = this.resolveSignature(decl.ref.from);
        if (inherited) {
          result[name] = inherited;
        }
      }
    }

    return result;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}
