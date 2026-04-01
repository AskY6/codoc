import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseCodocText, type ParsedCodoc } from "@cobook/core";

import { getPostgresDatabase } from "../database/postgres.js";

import type { CodocStore } from "./types.js";

interface DocumentRow {
  document_id: string;
  source_path: string;
  content: string;
}

export interface PostgresCodocStoreOptions {
  connectionString?: string;
}

export class PostgresCodocStore implements CodocStore {
  readonly #options: PostgresCodocStoreOptions;
  readonly #database;

  constructor(options: PostgresCodocStoreOptions = {}) {
    this.#options = options;
    this.#database = getPostgresDatabase(this.#options.connectionString);
  }

  async load(
    root: string,
    fallbackCodocs: Map<string, ParsedCodoc>
  ): Promise<Map<string, ParsedCodoc>> {
    const pool = await this.#database.ready();
    const client = await pool.connect();
    const workspaceRoot = normalizeWorkspaceRoot(root);

    try {
      await client.query("BEGIN");
      for (const codoc of fallbackCodocs.values()) {
        await client.query(
          [
            "INSERT INTO documents (workspace_root, document_id, source_path, document_kind, content, metadata)",
            "VALUES ($1, $2, $3, 'codoc', $4, $5::jsonb)",
            "ON CONFLICT (workspace_root, document_id) DO NOTHING"
          ].join(" "),
          [
            workspaceRoot,
            codoc.id,
            codoc.filePath,
            readFallbackCodocContent(root, codoc.filePath),
            JSON.stringify(codoc.meta ?? {})
          ]
        );
      }

      const rows = await client.query<DocumentRow>(
        [
          "SELECT document_id, source_path, content FROM documents",
          "WHERE workspace_root = $1 AND document_kind = 'codoc'",
          "ORDER BY created_at, document_id"
        ].join(" "),
        [workspaceRoot]
      );
      await client.query("COMMIT");
      return parseRows(rows.rows);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async readContent(root: string, codocId: string, filePath: string): Promise<string | null> {
    const pool = await this.#database.ready();
    const result = await pool.query<{ content: string }>(
      [
        "SELECT content FROM documents",
        "WHERE workspace_root = $1 AND document_kind = 'codoc'",
        "AND (document_id = $2 OR source_path = $3)",
        "ORDER BY CASE WHEN document_id = $2 THEN 0 ELSE 1 END",
        "LIMIT 1"
      ].join(" "),
      [normalizeWorkspaceRoot(root), codocId, filePath]
    );
    return result.rows[0]?.content ?? null;
  }

  async write(
    root: string,
    input: {
      codocId: string;
      filePath: string;
      content: string;
      overwrite?: boolean;
    }
  ): Promise<void> {
    const pool = await this.#database.ready();
    const workspaceRoot = normalizeWorkspaceRoot(root);

    if (input.overwrite === false) {
      const existing = await pool.query(
        [
          "SELECT 1 FROM documents",
          "WHERE workspace_root = $1 AND document_kind = 'codoc'",
          "AND (document_id = $2 OR source_path = $3)",
          "LIMIT 1"
        ].join(" "),
        [workspaceRoot, input.codocId, input.filePath]
      );
      if (existing.rowCount) {
        throw new Error(`Codoc "${input.codocId}" already exists in PostgreSQL storage.`);
      }
    }

    await pool.query(
      [
        "INSERT INTO documents (workspace_root, document_id, source_path, document_kind, content, metadata)",
        "VALUES ($1, $2, $3, 'codoc', $4, '{}'::jsonb)",
        "ON CONFLICT (workspace_root, document_id) DO UPDATE SET",
        "source_path = EXCLUDED.source_path,",
        "content = EXCLUDED.content,",
        "updated_at = NOW()"
      ].join(" "),
      [workspaceRoot, input.codocId, input.filePath, input.content]
    );
  }

  async importFile(root: string, filePath: string): Promise<ParsedCodoc> {
    const raw = await readFile(join(root, filePath), "utf8");
    const parsed = parseCodocText(filePath, raw);
    await this.write(root, {
      codocId: parsed.id,
      filePath,
      content: raw,
      overwrite: true
    });
    return parsed;
  }
}

function normalizeWorkspaceRoot(root: string): string {
  return resolve(root);
}

function readFallbackCodocContent(root: string, filePath: string): string {
  return readFileSync(join(root, filePath), "utf8");
}

function parseRows(rows: DocumentRow[]): Map<string, ParsedCodoc> {
  const codocs = new Map<string, ParsedCodoc>();

  for (const row of rows) {
    const parsed = parseCodocText(row.source_path, row.content);
    if (codocs.has(parsed.id)) {
      throw new Error(`Duplicate codoc id "${parsed.id}" found in PostgreSQL storage.`);
    }

    codocs.set(parsed.id, parsed);
  }

  return codocs;
}
