import type { SourceProvider } from "@cobook/core";
import { SourceError } from "./types.js";

// ---------------------------------------------------------------------------
// SourceRegistry
//
// A per-service registry of `SourceProvider`s. The registry is created via
// `createSourceRegistry()` and injected into `BuildService`, which calls
// `execute` when a codoc field has `$source`. This replaces the prior
// module-level `serverRegistry` singleton so that two services constructed
// in the same process (e.g. in tests) can have independent source sets.
// ---------------------------------------------------------------------------

export interface SourceRegistry {
  register(provider: SourceProvider): void;
  execute(source: string, params: Record<string, unknown>): Promise<unknown>;
}

export function createSourceRegistry(
  providers: SourceProvider[] = [],
): SourceRegistry {
  const registry = new Map<string, SourceProvider>();
  for (const provider of providers) {
    registry.set(provider.name, provider);
  }

  return {
    register(provider) {
      registry.set(provider.name, provider);
    },
    async execute(source, params) {
      const provider = registry.get(source);
      if (!provider) {
        throw new SourceError(`Unknown source: "${source}"`, source);
      }
      return (await provider.resolve(params)).data;
    },
  };
}
