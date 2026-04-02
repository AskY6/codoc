import type {
  ChatRepository,
  AgentSessionRepository,
  ChatThread,
  ChatMessage,
} from "./db/repositories/types.js";
import type { WorkspaceService } from "./workspace-service.js";

// ---------------------------------------------------------------------------
// ChatService interface
// ---------------------------------------------------------------------------

export interface ChatService {
  createThread(workspaceId: string, title?: string): Promise<ChatThread>;
  getThread(threadId: string): Promise<{ thread: ChatThread; messages: ChatMessage[] } | undefined>;
  listThreads(workspaceId: string): Promise<ChatThread[]>;
  addMessage(threadId: string, msg: { role: string; content: string }): Promise<ChatMessage>;
  getMessages(threadId: string): Promise<ChatMessage[]>;
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

    async addMessage(threadId, msg) {
      return chatRepo.addMessage(threadId, msg);
    },

    async getMessages(threadId) {
      return chatRepo.getMessages(threadId);
    },
  };
}
