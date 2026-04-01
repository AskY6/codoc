export type WorkspaceChangeKind = "created" | "updated" | "deleted";

export interface WorkspaceChangeEvent {
  kind: WorkspaceChangeKind;
  path: string;
}
