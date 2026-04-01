export interface ScanOptions {
  include: string[];
  exclude: string[];
}

export interface WorkspaceFileRecord {
  path: string;
  kind: "codoc" | "config" | "asset";
}
