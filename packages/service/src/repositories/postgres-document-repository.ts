import { resolve } from "node:path";

import { getPostgresDatabase } from "../database/postgres.js";

import type {
  DocumentRepository,
  RepositoryDocumentRecord,
  UpsertRepositoryDocumentInput
} from "./types.js";

interface DocumentRow {
  workspace_root: string;
  document_id: string;
  source_path: string;
  document_kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface PostgresDocumentRepositoryOptions {
  connectionString?: string | undefined;
}

export class PostgresDocumentRepository implements DocumentRepository {
  readonly #database;

  constructor(options: PostgresDocumentRepositoryOptions = {}) {
    this.#database = getPostgresDatabase(options.connectionString);
  }

  async listByWorkspace(workspaceRoot: string): Promise<RepositoryDocumentRecord[]> {
    const pool = await this.#database.ready();
    const result = await pool.query<DocumentRow>(
      [
        "SELECT workspace_root, document_id, source_path, document_kind, title, content, metadata, created_at, updated_at",
        "FROM documents",
        "WHERE workspace_root = $1",
        "ORDER BY created_at, document_id"
      ].join(" "),
      [normalizeWorkspaceRoot(workspaceRoot)]
    );
    return result.rows.map(mapDocumentRow);
  }

  async getById(
    workspaceRoot: string,
    documentId: string
  ): Promise<RepositoryDocumentRecord | null> {
    const pool = await this.#database.ready();
    const result = await pool.query<DocumentRow>(
      [
        "SELECT workspace_root, document_id, source_path, document_kind, title, content, metadata, created_at, updated_at",
        "FROM documents",
        "WHERE workspace_root = $1 AND document_id = $2",
        "LIMIT 1"
      ].join(" "),
      [normalizeWorkspaceRoot(workspaceRoot), documentId]
    );
    return result.rows[0] ? mapDocumentRow(result.rows[0]) : null;
  }

  async getBySourcePath(
    workspaceRoot: string,
    sourcePath: string
  ): Promise<RepositoryDocumentRecord | null> {
    const pool = await this.#database.ready();
    const result = await pool.query<DocumentRow>(
      [
        "SELECT workspace_root, document_id, source_path, document_kind, title, content, metadata, created_at, updated_at",
        "FROM documents",
        "WHERE workspace_root = $1 AND source_path = $2",
        "LIMIT 1"
      ].join(" "),
      [normalizeWorkspaceRoot(workspaceRoot), sourcePath]
    );
    return result.rows[0] ? mapDocumentRow(result.rows[0]) : null;
  }

  async upsert(input: UpsertRepositoryDocumentInput): Promise<RepositoryDocumentRecord> {
    const pool = await this.#database.ready();
    const result = await pool.query<DocumentRow>(
      [
        "INSERT INTO documents (workspace_root, document_id, source_path, document_kind, title, content, metadata)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
        "ON CONFLICT (workspace_root, document_id) DO UPDATE SET",
        "source_path = EXCLUDED.source_path,",
        "document_kind = EXCLUDED.document_kind,",
        "title = EXCLUDED.title,",
        "content = EXCLUDED.content,",
        "metadata = EXCLUDED.metadata,",
        "updated_at = NOW()",
        "RETURNING workspace_root, document_id, source_path, document_kind, title, content, metadata, created_at, updated_at"
      ].join(" "),
      [
        normalizeWorkspaceRoot(input.workspaceRoot),
        input.documentId,
        input.sourcePath,
        input.documentKind ?? "codoc",
        input.title ?? null,
        input.content,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to upsert document in PostgreSQL.");
    }

    return mapDocumentRow(row);
  }
}

function mapDocumentRow(row: DocumentRow): RepositoryDocumentRecord {
  return {
    workspaceRoot: row.workspace_root,
    documentId: row.document_id,
    sourcePath: row.source_path,
    documentKind: row.document_kind,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot);
}
