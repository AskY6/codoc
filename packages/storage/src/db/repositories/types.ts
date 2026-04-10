// ---------------------------------------------------------------------------
// Row types (inferred from schema)
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Codoc {
  id: string;
  workspaceId: string;
  path: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ResolvedFieldState = "ready" | "error";

export interface ResolvedField {
  id: string;
  workspaceId: string;
  codocId: string;
  nodeId: string;
  value: unknown;
  state: ResolvedFieldState;
  builtAt: Date;
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

export interface ChatMessageMetadata {
  toolCalls?: { name: string; input: Record<string, unknown> }[];
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: string;
  content: string;
  agentId: string | null;
  metadata: ChatMessageMetadata | null;
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

export interface WorkspaceListItem extends Workspace {
  codocCount: number;
  agentCount: number;
}

export interface WorkspaceRepository {
  create(data: { name: string; description?: string }): Promise<Workspace>;
  update(id: string, data: { name?: string; description?: string | null }): Promise<Workspace>;
  findById(id: string): Promise<Workspace | undefined>;
  list(): Promise<Workspace[]>;
  listWithStats(): Promise<WorkspaceListItem[]>;
  delete(id: string): Promise<void>;
}

export interface CodocRepository {
  upsert(
    workspaceId: string,
    path: string,
    data: { content?: string },
  ): Promise<Codoc>;
  findById(id: string): Promise<Codoc | undefined>;
  findByPath(workspaceId: string, path: string): Promise<Codoc | undefined>;
  listByWorkspace(workspaceId: string): Promise<Codoc[]>;
  delete(workspaceId: string, path: string): Promise<void>;
}

export interface ResolvedFieldRepository {
  /**
   * Atomically replace the set of resolved fields for a single codoc.
   * Deletes all existing rows with matching codocId, then inserts the new
   * set. The (workspace_id, node_id) unique index guarantees that stale
   * node_ids from previous builds are evicted even if node_ids have moved
   * between codocs.
   */
  replaceForCodoc(
    workspaceId: string,
    codocId: string,
    fields: { nodeId: string; value: unknown; state: ResolvedFieldState }[],
  ): Promise<void>;
  /**
   * Upsert a single field — used by `resolveNode` when resolving a node
   * on demand without rewriting the whole codoc's field set.
   */
  upsertField(
    workspaceId: string,
    codocId: string,
    nodeId: string,
    value: unknown,
    state: ResolvedFieldState,
  ): Promise<void>;
  listByCodoc(codocId: string): Promise<ResolvedField[]>;
  listByWorkspace(workspaceId: string): Promise<ResolvedField[]>;
  findByNodeId(
    workspaceId: string,
    nodeId: string,
  ): Promise<ResolvedField | undefined>;
}

export interface EdgeRepository {
  replaceAll(
    workspaceId: string,
    newEdges: { fromNodeId: string; toNodeId: string }[],
  ): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<Edge[]>;
}

export interface ThreadCodoc {
  id: string;
  threadId: string;
  codocId: string;
  createdAt: Date;
}

export interface ThreadAgent {
  id: string;
  threadId: string;
  agentId: string;
  createdAt: Date;
}

export interface WorkspaceAgent {
  id: string;
  workspaceId: string;
  agentId: string;
  createdAt: Date;
}

export interface ChatRepository {
  createThread(workspaceId: string, title?: string): Promise<ChatThread>;
  getThread(threadId: string): Promise<ChatThread | undefined>;
  listThreads(workspaceId: string): Promise<ChatThread[]>;
  updateThread(threadId: string, data: { title?: string }): Promise<ChatThread>;
  deleteThread(threadId: string): Promise<void>;
  addMessage(
    threadId: string,
    msg: { role: string; content: string; agentId?: string; metadata?: ChatMessageMetadata },
  ): Promise<ChatMessage>;
  getMessages(threadId: string): Promise<ChatMessage[]>;
  setThreadCodocs(threadId: string, codocIds: string[]): Promise<void>;
  getThreadCodocs(threadId: string): Promise<ThreadCodoc[]>;
  setThreadAgents(threadId: string, agentIds: string[]): Promise<void>;
  getThreadAgents(threadId: string): Promise<ThreadAgent[]>;
  setWorkspaceAgents(workspaceId: string, agentIds: string[]): Promise<void>;
  getWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]>;
}

export interface AgentSessionRepository {
  upsert(
    workspaceId: string,
    threadId: string | null,
    data: { activeSceneId?: string | null; state?: Record<string, unknown> },
  ): Promise<AgentSession>;
  findByWorkspace(workspaceId: string): Promise<AgentSession | undefined>;
}
