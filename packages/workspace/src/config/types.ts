export interface RefDirectory {
  $ref: string;
}

export interface CobookAgentConfig {
  name: string;
  description?: string;
  prompt?: string;
  pinnedCodocIds?: string[];
  outputDir?: string;
}

export interface CobookWorkflowConfig {
  name: string;
  description?: string;
  agent?: string;
  pinnedCodocIds?: string[];
  dataRefs?: Record<string, string>;
  outputDir?: string;
}

export interface CobookConfig {
  cobook: string;
  name: string;
  entry?: string;
  include?: string[];
  exclude?: string[];
  schemas?: RefDirectory;
  components?: RefDirectory;
  agents?: Record<string, CobookAgentConfig>;
  workflows?: Record<string, CobookWorkflowConfig>;
  sources?: unknown[];
  build?: Record<string, unknown>;
}
