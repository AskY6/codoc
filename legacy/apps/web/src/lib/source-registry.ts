export interface SourceResult {
  data: unknown;
  meta?: { title?: string; description?: string; tags?: string[] };
  view?: unknown;
}

export interface SourceProvider {
  name: string;
  resolve(params: Record<string, unknown>): Promise<SourceResult>;
}

const clientRegistry = new Map<string, SourceProvider>();

export function registerClientSource(provider: SourceProvider): void {
  clientRegistry.set(provider.name, provider);
}

export function isClientSourceName(name: string): boolean {
  return name.startsWith("local:");
}

export async function resolveClientSource(
  source: string,
  params: Record<string, unknown>,
): Promise<SourceResult> {
  const provider = clientRegistry.get(source);
  if (!provider) throw new Error(`Unknown client source: "${source}"`);
  return provider.resolve(params);
}
