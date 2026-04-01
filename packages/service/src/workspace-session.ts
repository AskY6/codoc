import type { BuildResult, ComponentSpec, DagEngine, ParsedCodoc, RuntimeContext } from "@cobook/core";
import type { CobookConfig } from "@cobook/workspace";

import type { SourceExecutor } from "./source-executor/index.js";

export interface WorkspaceSession {
  root: string;
  config: CobookConfig;
  codocs: Map<string, ParsedCodoc>;
  componentRegistry: Record<string, ComponentSpec>;
  dag: DagEngine;
  runtime: RuntimeContext;
  sourceExecutor: SourceExecutor;
  lastBuild: BuildResult | null;
  watchControllers: Set<AbortController>;
}
