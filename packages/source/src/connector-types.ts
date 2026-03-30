/**
 * Connector function: given config and auth, returns data.
 */
export type ConnectorFn = (
  config: Record<string, unknown>,
  auth: ConnectorAuth | undefined,
) => Promise<unknown>;

/**
 * Connector auth — shape varies per platform.
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

/**
 * A connector definition exported by connector packages.
 */
export interface ConnectorDefinition {
  meta: ConnectorMeta;
  fn: ConnectorFn;
  /** Env var names to load as credentials. e.g. { appId: "FEISHU_APP_ID" } */
  envAuth?: Record<string, string>;
}
