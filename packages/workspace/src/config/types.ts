export interface RefDirectory {
  $ref: string;
}

export interface CobookConfig {
  cobook: string;
  name: string;
  entry?: string;
  include?: string[];
  exclude?: string[];
  schemas?: RefDirectory;
  components?: RefDirectory;
  agents?: Record<string, unknown>;
  sources?: unknown[];
  build?: Record<string, unknown>;
}
