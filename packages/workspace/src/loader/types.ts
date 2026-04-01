import type { ComponentSpec, ParsedCodoc } from "@cobook/core";

import type { CobookConfig } from "../config/types.js";

export interface CodocSummary {
  id: string;
  filePath: string;
  hasData: boolean;
  hasView: boolean;
  hasComponents: boolean;
}

export interface WorkspaceSnapshot {
  root: string;
  config: CobookConfig;
  codocs: CodocSummary[];
  componentRegistry: Record<string, ComponentSpec>;
}

export interface LoadedWorkspace {
  root: string;
  config: CobookConfig;
  codocs: Map<string, ParsedCodoc>;
  componentRegistry: Record<string, ComponentSpec>;
}
