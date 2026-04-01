import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { chatThreads, chatMessages } from "../schema.js";
import type { ChatThread, ChatMessage, ChatRepository } from "./types.js";

export function createChatRepository(db: Database): ChatRepository {
  return {
    async createThread(workspaceId, title) {
      const [row] = await db
        .insert(chatThreads)
        .values({ workspaceId, title: title ?? null })
        .returning();
      return row as ChatThread;
    },

    async getThread(threadId) {
      const [row] = await db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.id, threadId));
      return row as ChatThread | undefined;
    },

    async listThreads(workspaceId) {
      return (await db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.workspaceId, workspaceId))) as ChatThread[];
    },

    async addMessage(threadId, msg) {
      const [row] = await db
        .insert(chatMessages)
        .values({ threadId, role: msg.role, content: msg.content })
        .returning();
      return row as ChatMessage;
    },

    async getMessages(threadId) {
      return (await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.threadId, threadId))) as ChatMessage[];
    },
  };
}
