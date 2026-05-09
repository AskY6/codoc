// Source provider port.
//
// A source provider fetches an external value for a `kind: "source"`
// data field. The evaluation engine calls registered providers during
// resolution; the core DAG layer never sees providers directly.

/**
 * A single source provider. Each provider handles one `source` name
 * (e.g. "http-json") and produces a value from opaque params.
 */
export interface SourceProvider {
  readonly name: string;
  execute(params: Readonly<Record<string, unknown>>): Promise<unknown>;
  /**
   * Merge incoming data with an existing cached value.
   * Called by the scheduler after each periodic refresh.
   * When absent, the scheduler uses replace (incoming overwrites existing).
   */
  merge?(existing: unknown, incoming: unknown): unknown;
}

/**
 * Provider registry keyed by source name.
 *
 * The composition root builds this map from concrete provider
 * implementations and injects it into the runtime context.
 */
export type SourceRegistry = ReadonlyMap<string, SourceProvider>;
