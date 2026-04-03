import type {
  ChatRepository,
  AgentSessionRepository,
  ChatThread,
  ChatMessage,
  ThreadCodoc,
  ThreadAgent,
  WorkspaceAgent,
} from "./db/repositories/types.js";
import type { WorkspaceService } from "./workspace-service.js";

// ---------------------------------------------------------------------------
// ChatService interface
// ---------------------------------------------------------------------------

export interface ChatService {
  createThread(workspaceId: string, title?: string): Promise<ChatThread>;
  getThread(threadId: string): Promise<{ thread: ChatThread; messages: ChatMessage[] } | undefined>;
  listThreads(workspaceId: string): Promise<ChatThread[]>;
  updateThread(threadId: string, data: { title?: string }): Promise<ChatThread>;
  deleteThread(threadId: string): Promise<void>;
  addMessage(threadId: string, msg: { role: string; content: string; agentId?: string }): Promise<ChatMessage>;
  getMessages(threadId: string): Promise<ChatMessage[]>;
  setThreadCodocs(threadId: string, codocIds: string[]): Promise<void>;
  getThreadCodocs(threadId: string): Promise<ThreadCodoc[]>;
  setThreadAgents(threadId: string, agentIds: string[]): Promise<void>;
  getThreadAgents(threadId: string): Promise<ThreadAgent[]>;
  setWorkspaceAgents(workspaceId: string, agentIds: string[]): Promise<void>;
  getWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ChatServiceDeps {
  chatRepo: ChatRepository;
  agentSessionRepo: AgentSessionRepository;
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const { chatRepo } = deps;

  return {
    async createThread(workspaceId, title) {
      return chatRepo.createThread(workspaceId, title);
    },

    async getThread(threadId) {
      const thread = await chatRepo.getThread(threadId);
      if (!thread) return undefined;
      const messages = await chatRepo.getMessages(threadId);
      return { thread, messages };
    },

    async listThreads(workspaceId) {
      return chatRepo.listThreads(workspaceId);
    },

    async updateThread(threadId, data) {
      return chatRepo.updateThread(threadId, data);
    },

    async deleteThread(threadId) {
      return chatRepo.deleteThread(threadId);
    },

    async addMessage(threadId, msg) {
      return chatRepo.addMessage(threadId, msg);
    },

    async getMessages(threadId) {
      return chatRepo.getMessages(threadId);
    },

    async setThreadCodocs(threadId, codocIds) {
      return chatRepo.setThreadCodocs(threadId, codocIds);
    },

    async getThreadCodocs(threadId) {
      return chatRepo.getThreadCodocs(threadId);
    },

    async setThreadAgents(threadId, agentIds) {
      return chatRepo.setThreadAgents(threadId, agentIds);
    },

    async getThreadAgents(threadId) {
      return chatRepo.getThreadAgents(threadId);
    },

    async setWorkspaceAgents(workspaceId, agentIds) {
      return chatRepo.setWorkspaceAgents(workspaceId, agentIds);
    },

    async getWorkspaceAgents(workspaceId) {
      return chatRepo.getWorkspaceAgents(workspaceId);
    },
  };
}
