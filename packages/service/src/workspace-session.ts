import type { DagEngine, ParsedCodoc, RuntimeContext } from "@cobook/core";
import type { CobookConfig } from "@cobook/workspace";

export interface WorkspaceSession {
  root: string;
  config: CobookConfig;
  codocs: Map<string, ParsedCodoc>;
  dag: DagEngine;
  runtime: RuntimeContext;
}
