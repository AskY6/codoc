/**
 * Connector function: given config and auth, returns data.
 * Pure function, stateless, testable.
 */
export type ConnectorFn = (
  config: Record<string, unknown>,
  auth: ConnectorAuth | undefined,
) => Promise<unknown>;

/**
 * Connector auth — shape varies per platform.
 * Each connector validates its own auth structure.
 */
export type ConnectorAuth = Record<string, unknown>;

/**
 * Connector metadata for agent-assisted YAML generation.
 */
export interface ConnectorMeta {
  name: string;
  displayName: string;
  description: string;
  configSchema: Record<string, unknown>;
  authSchema: Record<string, unknown>;
  exampleYaml: string;
}
