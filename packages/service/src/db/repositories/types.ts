// ---------------------------------------------------------------------------
// Row types (inferred from schema)
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Codoc {
  id: string;
  workspaceId: string;
  path: string;
  content: string;
  ast: unknown;
  resolvedValue: unknown;
  nodeState: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Edge {
  id: string;
  workspaceId: string;
  fromNodeId: string;
  toNodeId: string;
  createdAt: Date;
}

export interface ChatThread {
  id: string;
  workspaceId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: string;
  content: string;
  createdAt: Date;
}

export interface AgentSession {
  id: string;
  workspaceId: string;
  threadId: string | null;
  activeSceneId: string | null;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Repository interfaces
// ---------------------------------------------------------------------------

export interface WorkspaceRepository {
  create(data: { name: string }): Promise<Workspace>;
  findById(id: string): Promise<Workspace | undefined>;
  list(): Promise<Workspace[]>;
  delete(id: string): Promise<void>;
}

export interface CodocRepository {
  upsert(
    workspaceId: string,
    path: string,
    data: { content?: string; ast?: unknown; resolvedValue?: unknown; nodeState?: string },
  ): Promise<Codoc>;
  findByPath(workspaceId: string, path: string): Promise<Codoc | undefined>;
  listByWorkspace(workspaceId: string): Promise<Codoc[]>;
  delete(workspaceId: string, path: string): Promise<void>;
}

export interface EdgeRepository {
  replaceAll(
    workspaceId: string,
    newEdges: { fromNodeId: string; toNodeId: string }[],
  ): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<Edge[]>;
}

export interface ChatRepository {
  createThread(workspaceId: string, title?: string): Promise<ChatThread>;
  getThread(threadId: string): Promise<ChatThread | undefined>;
  listThreads(workspaceId: string): Promise<ChatThread[]>;
  addMessage(
    threadId: string,
    msg: { role: string; content: string },
  ): Promise<ChatMessage>;
  getMessages(threadId: string): Promise<ChatMessage[]>;
}

export interface AgentSessionRepository {
  upsert(
    workspaceId: string,
    threadId: string | null,
    data: { activeSceneId?: string | null; state?: Record<string, unknown> },
  ): Promise<AgentSession>;
  findByWorkspace(workspaceId: string): Promise<AgentSession | undefined>;
}
