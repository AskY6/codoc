import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseCodocText, type ParsedCodoc } from "@cobook/core";

import { PostgresDocumentRepository } from "../repositories/postgres-document-repository.js";

import type { CodocStore } from "./types.js";

export interface PostgresCodocStoreOptions {
  connectionString?: string | undefined;
}

export class PostgresCodocStore implements CodocStore {
  readonly #options: PostgresCodocStoreOptions;
  readonly #documents;

  constructor(options: PostgresCodocStoreOptions = {}) {
    this.#options = options;
    this.#documents = new PostgresDocumentRepository({
      connectionString: this.#options.connectionString
    });
  }

  async load(
    root: string,
    fallbackCodocs: Map<string, ParsedCodoc>
  ): Promise<Map<string, ParsedCodoc>> {
    const workspaceRoot = normalizeWorkspaceRoot(root);
    for (const codoc of fallbackCodocs.values()) {
      const existing =
        (await this.#documents.getById(workspaceRoot, codoc.id)) ??
        (await this.#documents.getBySourcePath(workspaceRoot, codoc.filePath));
      if (!existing) {
        await this.#documents.upsert({
          workspaceRoot,
          documentId: codoc.id,
          sourcePath: codoc.filePath,
          documentKind: "codoc",
          content: readFallbackCodocContent(root, codoc.filePath),
          metadata: codoc.meta ?? {}
        });
      }
    }

    const documents = await this.#documents.listByWorkspace(workspaceRoot);
    return parseRows(
      documents
        .filter((document) => document.documentKind === "codoc")
        .map((document) => ({
          source_path: document.sourcePath,
          content: document.content
        }))
    );
  }

  async readContent(root: string, codocId: string, filePath: string): Promise<string | null> {
    const workspaceRoot = normalizeWorkspaceRoot(root);
    const byId = await this.#documents.getById(workspaceRoot, codocId);
    if (byId?.documentKind === "codoc") {
      return byId.content;
    }

    const byPath = await this.#documents.getBySourcePath(workspaceRoot, filePath);
    return byPath?.documentKind === "codoc" ? byPath.content : null;
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
    const workspaceRoot = normalizeWorkspaceRoot(root);

    if (input.overwrite === false) {
      const existingById = await this.#documents.getById(workspaceRoot, input.codocId);
      const existingByPath = await this.#documents.getBySourcePath(workspaceRoot, input.filePath);
      if (
        (existingById && existingById.documentKind === "codoc") ||
        (existingByPath && existingByPath.documentKind === "codoc")
      ) {
        throw new Error(`Codoc "${input.codocId}" already exists in PostgreSQL storage.`);
      }
    }

    await this.#documents.upsert({
      workspaceRoot,
      documentId: input.codocId,
      sourcePath: input.filePath,
      documentKind: "codoc",
      content: input.content
    });
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

function parseRows(rows: Array<{ source_path: string; content: string }>): Map<string, ParsedCodoc> {
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
