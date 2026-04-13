// Source provider port.
//
// A source provider fetches an external value for a `kind: "source"`
// data field. The service layer calls registered providers during
// evaluation; the core DAG layer never sees providers directly.

/**
 * A single source provider. Each provider handles one `source` name
 * (e.g. "http-json") and produces a value from opaque params.
 */
export interface SourceProvider {
  readonly name: string;
  execute(params: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/**
 * Provider registry keyed by source name.
 *
 * The composition root builds this map from concrete provider
 * implementations and injects it into `ServiceCtx`.
 */
export type SourceRegistry = ReadonlyMap<string, SourceProvider>;
