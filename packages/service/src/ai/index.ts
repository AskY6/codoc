export interface ChatInput {
  message: string;
  pinnedCodocIds?: string[];
  agentId?: string;
}

export type ChatEvent = StatusEvent | MessageEvent | ArtifactEvent;

export interface StatusEvent {
  kind: "status";
  status: "thinking" | "reading" | "writing" | "done";
  message?: string;
}

export interface MessageEvent {
  kind: "message";
  content: string;
}

export interface ArtifactEvent {
  kind: "artifact";
  filePath: string;
}
