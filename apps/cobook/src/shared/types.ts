// Shared types between server API and client.
// No imports from @codoc/core — these are the HTTP contract.

export interface FieldSnapshot {
  status: "idle" | "pending" | "resolved" | "error" | "dirty";
  value?: unknown;
  error?: string;
  loaderType: string;
}

export interface ExternalDep {
  localPath: string;
  docRef: string;
  fieldPath: string;
}

export interface DocSnapshot {
  docId: string;
  fields: Record<string, FieldSnapshot>;
  view: string;
  externalRefs: ExternalDep[];
}

export interface FieldAddress {
  docId: string;
  fieldPath: string;
}

export interface DepEdge {
  from: FieldAddress;
  to: FieldAddress;
}

export interface DocMeta {
  docId: string;
  fields: Array<{
    path: string;
    loaderType: string;
    description?: string;
  }>;
}

export interface WorkspaceSnapshot {
  docs: DocMeta[];
  graph: { nodes: FieldAddress[]; edges: DepEdge[] };
}

export interface FieldEvent {
  docId: string;
  path: string;
  status: string;
  value?: unknown;
  error?: string;
  ts: number;
}

export interface FieldAction {
  path: string;
  action: "update" | "reforce";
  value?: unknown;
}
