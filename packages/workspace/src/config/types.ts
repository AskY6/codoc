import type { DataSpec } from "@cobook/core";

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

export type CobookSourceConfig = Extract<DataSpec, { kind: "static" | "file" | "http" | "rss" | "preset" }>;

export interface CobookConfig {
  cobook: string;
  name: string;
  entry?: string;
  include?: string[];
  exclude?: string[];
  plugins?: string[];
  schemas?: RefDirectory;
  components?: RefDirectory;
  agents?: Record<string, CobookAgentConfig>;
  workflows?: Record<string, CobookWorkflowConfig>;
  sources?: Record<string, CobookSourceConfig>;
  build?: Record<string, unknown>;
}
