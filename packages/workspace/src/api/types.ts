import type { DataTree, LoaderDeclaration } from "@codoc/core";
import type { DAG } from "@codoc/graph";

export interface FieldMeta {
  path: string;
  loaderType: LoaderDeclaration["type"];
  schema?: Record<string, unknown>;
  description?: string;
}

export interface DocMeta {
  docId: string;
  type: Record<string, unknown>;
  fields: FieldMeta[];
  externalRefs: Array<{ localPath: string; docRef: string; fieldPath: string }>;
}

export interface FieldAddress {
  docId: string;
  fieldPath: string;
}

export interface DepEdge {
  from: FieldAddress;
  to: FieldAddress;
}

export interface WorkspaceChangeEvent {
  docId: string;
  fieldPath: string;
  timestamp: number;
}

export interface CodocRuntime {
  tree: DataTree;
  dag: DAG;
}
