import { PostgresAgentSessionRepository } from "./postgres-agent-session-repository.js";
import { PostgresChatRepository } from "./postgres-chat-repository.js";
import { PostgresDocumentRepository } from "./postgres-document-repository.js";
import type { ServiceRepositories } from "./types.js";

export interface CreatePostgresRepositoriesOptions {
  connectionString?: string;
}

export function createPostgresRepositories(
  options: CreatePostgresRepositoriesOptions = {}
): ServiceRepositories {
  return {
    documents: new PostgresDocumentRepository(options),
    chats: new PostgresChatRepository(options),
    agentSessions: new PostgresAgentSessionRepository(options)
  };
}
