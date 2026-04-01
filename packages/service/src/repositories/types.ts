export interface RepositoryDocumentRecord {
  workspaceRoot: string;
  documentId: string;
  sourcePath: string;
  documentKind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRepositoryDocumentInput {
  workspaceRoot: string;
  documentId: string;
  sourcePath: string;
  documentKind?: string;
  title?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentRepository {
  listByWorkspace(workspaceRoot: string): Promise<RepositoryDocumentRecord[]>;
  getById(workspaceRoot: string, documentId: string): Promise<RepositoryDocumentRecord | null>;
  getBySourcePath(
    workspaceRoot: string,
    sourcePath: string
  ): Promise<RepositoryDocumentRecord | null>;
  upsert(input: UpsertRepositoryDocumentInput): Promise<RepositoryDocumentRecord>;
}

export interface ChatThreadRecord {
  workspaceRoot: string;
  threadId: string;
  title: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  workspaceRoot: string;
  threadId: string;
  messageId: string;
  role: string;
  agentId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatRepository {
  getThread(workspaceRoot: string, threadId: string): Promise<ChatThreadRecord | null>;
  listMessages(workspaceRoot: string, threadId: string): Promise<ChatMessageRecord[]>;
}

export interface AgentSessionRecord {
  workspaceRoot: string;
  sessionId: string;
  activeSceneId: string | null;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionRepository {
  getBySessionId(workspaceRoot: string, sessionId: string): Promise<AgentSessionRecord | null>;
  upsert(input: {
    workspaceRoot: string;
    sessionId: string;
    activeSceneId: string | null;
    state: Record<string, unknown>;
  }): Promise<AgentSessionRecord>;
  deleteBySessionId(workspaceRoot: string, sessionId: string): Promise<void>;
}

export interface ServiceRepositories {
  documents?: DocumentRepository;
  chats?: ChatRepository;
  agentSessions?: AgentSessionRepository;
}
