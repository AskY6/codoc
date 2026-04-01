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
  getBySourcePath(workspaceRoot: string, sourcePath: string): Promise<RepositoryDocumentRecord | null>;
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
}

export interface RssSourceRecord {
  workspaceRoot: string;
  sourceId: string;
  documentId: string | null;
  title: string | null;
  feedUrl: string;
  status: string;
  syncState: string;
  lastSyncedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RssArticleRecord {
  workspaceRoot: string;
  sourceId: string;
  articleId: string;
  title: string | null;
  link: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RssRepository {
  getSourceByDocumentId(workspaceRoot: string, documentId: string): Promise<RssSourceRecord | null>;
  listArticles(workspaceRoot: string, sourceId: string): Promise<RssArticleRecord[]>;
}
