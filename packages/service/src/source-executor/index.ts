import type { DataSpec, NodeKey } from "@cobook/core";

export interface SourceExecutionContext {
  workspaceRoot: string;
  node: NodeKey;
}

export interface SourceExecutor {
  resolve(spec: DataSpec, context: SourceExecutionContext): Promise<unknown>;
}
