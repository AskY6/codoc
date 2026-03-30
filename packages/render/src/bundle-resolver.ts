import type {
  ComponentRef,
  ComponentsBody,
} from "@codoc/core";
import {
  isWorkspaceRef,
  isLocalBundleRef,
  isRegistryBundleRef,
} from "@codoc/core";

export type ResolvedComponent = unknown;

export interface BundleResolverOptions {
  /** Resolve a workspace:// reference to a component implementation */
  resolveWorkspace?: (fromRef: string) => Promise<ResolvedComponent | undefined>;
  /** Resolve a local bundle path to a component implementation */
  resolveLocal?: (bundlePath: string) => Promise<ResolvedComponent | undefined>;
  /** Resolve a registry:// bundle to a component implementation */
  resolveRegistry?: (bundle: string, version: string) => Promise<ResolvedComponent | undefined>;
}

export interface ResolveResult {
  components: Record<string, ResolvedComponent>;
  errors: Array<{ name: string; error: string }>;
}

/**
 * Resolve all component declarations in a codoc's components body
 * to actual component implementations.
 */
export async function resolveComponentBundles(
  componentsBody: ComponentsBody,
  options: BundleResolverOptions,
): Promise<ResolveResult> {
  const components: Record<string, ResolvedComponent> = {};
  const errors: Array<{ name: string; error: string }> = [];

  const entries = Object.entries(componentsBody);
  const results = await Promise.allSettled(
    entries.map(async ([name, decl]) => {
      const component = await resolveRef(decl.ref, options);
      return { name, component };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { name, component } = result.value;
      if (component !== undefined) {
        components[name] = component;
      } else {
        errors.push({ name, error: `Component "${name}" could not be resolved` });
      }
    } else {
      // Extract name from the rejection — find the corresponding entry
      const idx = results.indexOf(result);
      const name = entries[idx]?.[0] ?? "unknown";
      errors.push({ name, error: String(result.reason) });
    }
  }

  return { components, errors };
}

async function resolveRef(
  ref: ComponentRef,
  options: BundleResolverOptions,
): Promise<ResolvedComponent | undefined> {
  if (isWorkspaceRef(ref)) {
    if (!options.resolveWorkspace) {
      throw new Error(`No workspace resolver configured for ref: ${ref.from}`);
    }
    return options.resolveWorkspace(ref.from);
  }

  if (isRegistryBundleRef(ref)) {
    if (!options.resolveRegistry) {
      throw new Error(`No registry resolver configured for bundle: ${ref.bundle}@${ref.version}`);
    }
    return options.resolveRegistry(ref.bundle, ref.version);
  }

  if (isLocalBundleRef(ref)) {
    if (!options.resolveLocal) {
      throw new Error(`No local resolver configured for bundle: ${ref.bundle}`);
    }
    return options.resolveLocal(ref.bundle);
  }

  throw new Error(`Unknown component ref type: ${JSON.stringify(ref)}`);
}
