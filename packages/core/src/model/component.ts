// --- Component Signature (meta layer) ---

export interface PropMeta {
  type: string;
  description?: string;
}

export interface ComponentSignature {
  props: Record<string, PropMeta>;
  description?: string;
}

/** Map of component name → signature + description */
export type ComponentsMeta = Record<string, ComponentSignature>;

// --- Component References (body layer) ---

/** Workspace component library reference: workspace://lib/Name */
export interface WorkspaceComponentRef {
  from: string;
}

/** Local bundle path: ./components/Widget */
export interface LocalBundleRef {
  bundle: string;
}

/** Remote registry bundle (version-locked): registry://pkg/Name@1.2.0 */
export interface RegistryBundleRef {
  bundle: string;
  version: string;
}

export type ComponentRef =
  | WorkspaceComponentRef
  | LocalBundleRef
  | RegistryBundleRef;

export interface ComponentDeclaration {
  ref: ComponentRef;
}

/** Map of component name → bundle reference */
export type ComponentsBody = Record<string, ComponentDeclaration>;

// --- Helpers ---

export function isWorkspaceRef(ref: ComponentRef): ref is WorkspaceComponentRef {
  return "from" in ref;
}

export function isLocalBundleRef(ref: ComponentRef): ref is LocalBundleRef {
  return "bundle" in ref && !("version" in ref);
}

export function isRegistryBundleRef(ref: ComponentRef): ref is RegistryBundleRef {
  return "bundle" in ref && "version" in ref;
}

/**
 * Parse a component reference from YAML shorthand.
 *
 * Formats:
 *   { from: "workspace://ui-kit/Chart" }   → WorkspaceComponentRef
 *   { bundle: "./components/Widget" }       → LocalBundleRef
 *   { bundle: "registry://pkg/Name@1.2.0" } → RegistryBundleRef (auto-extract version)
 */
export function parseComponentRef(raw: Record<string, unknown>): ComponentRef {
  if (typeof raw["from"] === "string") {
    return { from: raw["from"] };
  }
  if (typeof raw["bundle"] === "string") {
    const bundle = raw["bundle"];
    if (typeof raw["version"] === "string") {
      return { bundle, version: raw["version"] };
    }
    // Auto-extract version from registry:// format
    const registryMatch = bundle.match(/^registry:\/\/(.+)@(.+)$/);
    if (registryMatch) {
      return { bundle: `registry://${registryMatch[1]}`, version: registryMatch[2] };
    }
    return { bundle };
  }
  throw new Error(`Invalid component reference: ${JSON.stringify(raw)}`);
}
