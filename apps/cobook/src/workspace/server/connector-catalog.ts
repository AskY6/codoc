import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  registerConnector,
  unregisterConnector,
  getCredentialStore,
} from "@codoc/source";
import type { ConnectorDefinition } from "@codoc/source";

type StatusListener = () => void;

/**
 * ConnectorCatalog — manages the full lifecycle:
 *   available (discovered from packages)
 *     → active (user-activated, registered in core)
 *     → inactive (user-deactivated, unregistered)
 *
 * Activation state persisted to .cobook/active-connectors.yaml
 */
class ConnectorCatalog {
  private available = new Map<string, ConnectorDefinition>();
  private active = new Set<string>();
  private docsDir: string | undefined;
  private listeners = new Set<StatusListener>();

  /** Register a connector as available (not yet active). */
  add(def: ConnectorDefinition): void {
    this.available.set(def.meta.name, def);
  }

  /** Get all available connector definitions. */
  listAvailable(): ConnectorDefinition[] {
    return [...this.available.values()];
  }

  /** Get a single definition. */
  get(name: string): ConnectorDefinition | undefined {
    return this.available.get(name);
  }

  /** Is this connector currently activated? */
  isActive(name: string): boolean {
    return this.active.has(name);
  }

  /** Activate a connector — registers in core registry. */
  async activate(name: string): Promise<boolean> {
    const def = this.available.get(name);
    if (!def) return false;
    if (this.active.has(name)) return true;

    // Load env var credentials if defined
    this.loadEnvAuth(def);

    registerConnector(def.meta, def.fn);
    this.active.add(name);
    this.notify();
    await this.persist();
    return true;
  }

  /** Deactivate a connector — unregisters from core registry. */
  async deactivate(name: string): Promise<boolean> {
    if (!this.active.has(name)) return false;

    unregisterConnector(name);
    this.active.delete(name);
    this.notify();
    await this.persist();
    return true;
  }

  /** Set docsDir for persistence. */
  setDocsDir(dir: string): void {
    this.docsDir = dir;
  }

  /** Restore previously activated connectors from disk. */
  async restore(): Promise<void> {
    if (!this.docsDir) return;
    const configPath = join(this.docsDir, ".cobook", "active-connectors.yaml");
    try {
      const content = await readFile(configPath, "utf-8");
      const list = parseYaml(content) as string[] | null;
      if (!Array.isArray(list)) return;
      for (const name of list) {
        if (this.available.has(name)) {
          await this.activate(name);
        }
      }
    } catch {
      // No saved state — nothing activated yet.
    }
  }

  /** Subscribe to activation/deactivation changes. */
  onChange(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Build status snapshot for API/SSE. */
  getStatuses(): Array<{
    name: string;
    displayName: string;
    description: string;
    active: boolean;
    authConfigured: boolean;
  }> {
    const store = getCredentialStore();
    return this.listAvailable().map((def) => ({
      name: def.meta.name,
      displayName: def.meta.displayName,
      description: def.meta.description,
      active: this.active.has(def.meta.name),
      authConfigured: store.has(def.meta.name),
    }));
  }

  // --- internals ---

  private loadEnvAuth(def: ConnectorDefinition): void {
    if (!def.envAuth) return;
    const store = getCredentialStore();
    if (store.has(def.meta.name)) return; // already configured from credentials.yaml

    const auth: Record<string, unknown> = {};
    let allPresent = true;
    for (const [key, envName] of Object.entries(def.envAuth)) {
      const val = process.env[envName];
      if (val) {
        auth[key] = val;
      } else {
        allPresent = false;
      }
    }
    if (allPresent && Object.keys(auth).length > 0) {
      store.set(def.meta.name, auth);
    }
  }

  private async persist(): Promise<void> {
    if (!this.docsDir) return;
    const configPath = join(this.docsDir, ".cobook", "active-connectors.yaml");
    try {
      await mkdir(dirname(configPath), { recursive: true });
      const list = [...this.active];
      await writeFile(configPath, stringifyYaml(list), "utf-8");
    } catch {
      // Best-effort persistence
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

// Singleton
let catalog: ConnectorCatalog | undefined;

export function getConnectorCatalog(): ConnectorCatalog {
  if (!catalog) catalog = new ConnectorCatalog();
  return catalog;
}
