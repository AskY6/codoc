import { resolve } from "node:path";

import { getPostgresDatabase } from "../database/postgres.js";

import type { ChatMessageRecord, ChatRepository, ChatThreadRecord } from "./types.js";

interface ChatThreadRow {
  workspace_root: string;
  thread_id: string;
  title: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface ChatMessageRow {
  workspace_root: string;
  thread_id: string;
  message_id: string;
  role: string;
  agent_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface PostgresChatRepositoryOptions {
  connectionString?: string | undefined;
}

export class PostgresChatRepository implements ChatRepository {
  readonly #database;

  constructor(options: PostgresChatRepositoryOptions = {}) {
    this.#database = getPostgresDatabase(options.connectionString);
  }

  async getThread(workspaceRoot: string, threadId: string): Promise<ChatThreadRecord | null> {
    const pool = await this.#database.ready();
    const result = await pool.query<ChatThreadRow>(
      [
        "SELECT workspace_root, thread_id, title, metadata, created_at, updated_at",
        "FROM chat_threads",
        "WHERE workspace_root = $1 AND thread_id = $2",
        "LIMIT 1"
      ].join(" "),
      [normalizeWorkspaceRoot(workspaceRoot), threadId]
    );

    return result.rows[0] ? mapChatThreadRow(result.rows[0]) : null;
  }

  async upsertThread(input: {
    workspaceRoot: string;
    threadId: string;
    title?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ChatThreadRecord> {
    const pool = await this.#database.ready();
    const result = await pool.query<ChatThreadRow>(
      [
        "INSERT INTO chat_threads (workspace_root, thread_id, title, metadata)",
        "VALUES ($1, $2, $3, $4::jsonb)",
        "ON CONFLICT (workspace_root, thread_id) DO UPDATE SET",
        "title = COALESCE(EXCLUDED.title, chat_threads.title),",
        "metadata = EXCLUDED.metadata,",
        "updated_at = NOW()",
        "RETURNING workspace_root, thread_id, title, metadata, created_at, updated_at"
      ].join(" "),
      [
        normalizeWorkspaceRoot(input.workspaceRoot),
        input.threadId,
        input.title ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to upsert chat thread in PostgreSQL.");
    }

    return mapChatThreadRow(row);
  }

  async listMessages(workspaceRoot: string, threadId: string): Promise<ChatMessageRecord[]> {
    const pool = await this.#database.ready();
    const result = await pool.query<ChatMessageRow>(
      [
        "SELECT workspace_root, thread_id, message_id, role, agent_id, content, metadata, created_at",
        "FROM chat_messages",
        "WHERE workspace_root = $1 AND thread_id = $2",
        "ORDER BY created_at, message_id"
      ].join(" "),
      [normalizeWorkspaceRoot(workspaceRoot), threadId]
    );

    return result.rows.map(mapChatMessageRow);
  }

  async appendMessage(input: {
    workspaceRoot: string;
    threadId: string;
    messageId: string;
    role: string;
    agentId?: string | null;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChatMessageRecord> {
    const pool = await this.#database.ready();
    const result = await pool.query<ChatMessageRow>(
      [
        "INSERT INTO chat_messages (workspace_root, thread_id, message_id, role, agent_id, content, metadata)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
        "RETURNING workspace_root, thread_id, message_id, role, agent_id, content, metadata, created_at"
      ].join(" "),
      [
        normalizeWorkspaceRoot(input.workspaceRoot),
        input.threadId,
        input.messageId,
        input.role,
        input.agentId ?? null,
        input.content,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to append chat message in PostgreSQL.");
    }

    return mapChatMessageRow(row);
  }
}

function mapChatThreadRow(row: ChatThreadRow): ChatThreadRecord {
  return {
    workspaceRoot: row.workspace_root,
    threadId: row.thread_id,
    title: row.title,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapChatMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    workspaceRoot: row.workspace_root,
    threadId: row.thread_id,
    messageId: row.message_id,
    role: row.role,
    agentId: row.agent_id,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString()
  };
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot);
}
