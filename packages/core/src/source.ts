// ---------------------------------------------------------------------------
// Source provider interface — the contract for all external data sources.
// ---------------------------------------------------------------------------

export interface SourceResult {
  data: unknown;
  meta?: { title?: string; description?: string; tags?: string[] };
  view?: unknown;
}

export interface SourceProvider {
  name: string;
  resolve(params: Record<string, unknown>): Promise<SourceResult>;
}

/**
 * Returns true for sources that must be resolved client-side (browser).
 * Convention: any source name starting with "local:" lives on the user's
 * machine and cannot be reached by the server.
 */
export function isClientSource(name: string): boolean {
  return name.startsWith("local:");
}
