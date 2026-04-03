// ---- Workspace ----

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStatus {
  codocCount: number;
  states: Record<string, number>;
}

// ---- Codoc ----

export interface CodocListItem {
  id: string;
  path: string;
  nodeState: string;
}

export interface CodocDetail {
  path: string;
  ast: CodocAST | null;
  resolvedData: Record<string, unknown> | null;
  nodeState: string;
}

export interface CodocAST {
  meta?: {
    title?: string;
    description?: string;
    schema?: Record<string, { type: string }>;
  };
  data?: Record<string, DataField>;
  view?: ViewNode;
}

export type DataField =
  | { kind: "static"; value: unknown }
  | { kind: "ref"; $ref: string }
  | { kind: "source"; source: string; params: Record<string, unknown> };

// ---- View ----

export interface ViewAction {
  type: "chat";
  prompt: string; // supports {{var.path}} interpolation
}

export interface ViewNode {
  type: string; // "stack" | "grid" | "tabs" | "timeline" | "section" | "text" | "markdown" | "table"
  props?: Record<string, unknown>;
  children?: ViewNode[];
  bind?: string; // data field binding
  action?: ViewAction; // interactive action triggered on click
  repeat?: {
    bind: string; // data path to an array (e.g. "data.articles")
    as: string; // loop variable name (e.g. "item")
  };
  template?: ViewNode; // child template rendered per array element when repeat is set
}

// ---- Graph ----

export interface GraphData {
  nodes: Array<{ path: string; nodeState: string }>;
  edges: Array<{ from: string; to: string }>;
}

// ---- Build ----

export interface BuildResult {
  ok: boolean;
  codocCount: number;
  edgeCount: number;
  errors: DiagnosticError[];
}

export interface DiagnosticError {
  kind: "cycle" | "broken-ref" | "parse-error" | "schema-error";
  message: string;
  path?: string;
  nodes?: string[];
}

// ---- Chat ----

export interface ChatThread {
  id: string;
  workspaceId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadCodoc {
  id: string;
  threadId: string;
  codocId: string;
  createdAt: string;
}

export interface ThreadAgent {
  id: string;
  threadId: string;
  agentId: string;
  createdAt: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  agentId: string | null;
  createdAt: string;
}

export type ChatEvent =
  | { kind: "text-delta"; text: string; agentId: string }
  | { kind: "tool-use"; toolName: string; input: Record<string, unknown>; agentId: string }
  | { kind: "tool-result"; toolName: string; output: unknown; agentId: string }
  | { kind: "done"; fullText: string; agentId: string }
  | { kind: "error"; message: string; agentId?: string };
