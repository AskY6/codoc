import type { SourceProvider } from "@cobook/core";
import { SourceError } from "./types.js";

const serverRegistry = new Map<string, SourceProvider>();

export function registerSource(provider: SourceProvider): void {
  serverRegistry.set(provider.name, provider);
}

export async function executeSource(
  source: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const provider = serverRegistry.get(source);
  if (!provider) throw new SourceError(`Unknown source: "${source}"`, source);
  return (await provider.resolve(params)).data;
}

/** Reset registry — only for tests. */
export function _resetSourceRegistry(): void {
  serverRegistry.clear();
}
