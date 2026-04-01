import type { BuildResult, DagEngine, ParsedCodoc, RuntimeContext } from "@cobook/core";
import type { CobookConfig } from "@cobook/workspace";

import type { SourceExecutor } from "./source-executor/index.js";

export interface WorkspaceSession {
  root: string;
  config: CobookConfig;
  codocs: Map<string, ParsedCodoc>;
  dag: DagEngine;
  runtime: RuntimeContext;
  sourceExecutor: SourceExecutor;
  lastBuild: BuildResult | null;
  watchControllers: Set<AbortController>;
}
