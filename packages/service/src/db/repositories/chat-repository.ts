import { eq, asc } from "drizzle-orm";
import type { Database } from "../client.js";
import { chatThreads, chatMessages, threadCodocs, threadAgents, workspaceAgents } from "../schema.js";
import type { ChatThread, ChatMessage, ThreadCodoc, ThreadAgent, WorkspaceAgent, ChatRepository } from "./types.js";

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

    async updateThread(threadId, data) {
      const [row] = await db
        .update(chatThreads)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(chatThreads.id, threadId))
        .returning();
      return row as ChatThread;
    },

    async deleteThread(threadId) {
      await db.delete(chatThreads).where(eq(chatThreads.id, threadId));
    },

    async addMessage(threadId, msg) {
      const [row] = await db
        .insert(chatMessages)
        .values({ threadId, role: msg.role, content: msg.content, agentId: msg.agentId ?? null })
        .returning();
      return row as ChatMessage;
    },

    async getMessages(threadId) {
      return (await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.threadId, threadId))
        .orderBy(asc(chatMessages.createdAt))) as ChatMessage[];
    },

    async setThreadCodocs(threadId, codocIds) {
      await db.delete(threadCodocs).where(eq(threadCodocs.threadId, threadId));
      if (codocIds.length > 0) {
        await db.insert(threadCodocs).values(
          codocIds.map((codocId) => ({ threadId, codocId })),
        );
      }
    },

    async getThreadCodocs(threadId) {
      return (await db
        .select()
        .from(threadCodocs)
        .where(eq(threadCodocs.threadId, threadId))) as ThreadCodoc[];
    },

    async setThreadAgents(threadId, agentIds) {
      await db.delete(threadAgents).where(eq(threadAgents.threadId, threadId));
      if (agentIds.length > 0) {
        await db.insert(threadAgents).values(
          agentIds.map((agentId) => ({ threadId, agentId })),
        );
      }
    },

    async getThreadAgents(threadId) {
      return (await db
        .select()
        .from(threadAgents)
        .where(eq(threadAgents.threadId, threadId))) as ThreadAgent[];
    },

    async setWorkspaceAgents(workspaceId, agentIds) {
      await db.delete(workspaceAgents).where(eq(workspaceAgents.workspaceId, workspaceId));
      if (agentIds.length > 0) {
        await db.insert(workspaceAgents).values(
          agentIds.map((agentId) => ({ workspaceId, agentId })),
        );
      }
    },

    async getWorkspaceAgents(workspaceId) {
      return (await db
        .select()
        .from(workspaceAgents)
        .where(eq(workspaceAgents.workspaceId, workspaceId))) as WorkspaceAgent[];
    },
  };
}
