import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCodocText, type ParsedCodoc } from "@cobook/core";
import { stringify as stringifyYaml } from "yaml";

import type { CodocStore } from "./types.js";

interface StoredCodocRecord {
  id: string;
  filePath: string;
  content: string;
  updatedAt: string;
}

interface StoredCodocDatabase {
  version: 1;
  codocs: StoredCodocRecord[];
}

const STORE_VERSION = 1;

export class JsonCodocStore implements CodocStore {
  async load(
    root: string,
    fallbackCodocs: Map<string, ParsedCodoc>
  ): Promise<Map<string, ParsedCodoc>> {
    const existing = await readDatabase(root);
    const merged = mergeWithFallback(existing, fallbackCodocs);
    await writeDatabase(root, merged);
    return parseDatabaseRecords(merged.codocs);
  }

  async readContent(root: string, codocId: string, filePath: string): Promise<string | null> {
    const database = await readDatabase(root);
    const record = database?.codocs.find(
      (entry) => entry.id === codocId || entry.filePath === filePath
    );
    return record?.content ?? null;
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
    const database = (await readDatabase(root)) ?? emptyDatabase();
    const nextRecord: StoredCodocRecord = {
      id: input.codocId,
      filePath: input.filePath,
      content: input.content,
      updatedAt: new Date().toISOString()
    };

    const existingIndex = database.codocs.findIndex(
      (entry) => entry.id === input.codocId || entry.filePath === input.filePath
    );
    if (existingIndex >= 0) {
      if (input.overwrite === false) {
        throw new Error(`Codoc "${input.codocId}" already exists in persisted storage.`);
      }

      database.codocs.splice(existingIndex, 1, nextRecord);
    } else {
      database.codocs.push(nextRecord);
    }

    await writeDatabase(root, database);
  }

  async importFile(root: string, filePath: string): Promise<ParsedCodoc> {
    const absolutePath = join(root, filePath);
    const raw = await readFile(absolutePath, "utf8");
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

function mergeWithFallback(
  database: StoredCodocDatabase | null,
  fallbackCodocs: Map<string, ParsedCodoc>
): StoredCodocDatabase {
  const merged = database ?? emptyDatabase();
  const existingById = new Map(merged.codocs.map((entry) => [entry.id, entry]));
  const existingByPath = new Map(merged.codocs.map((entry) => [entry.filePath, entry]));

  for (const codoc of fallbackCodocs.values()) {
    if (existingById.has(codoc.id) || existingByPath.has(codoc.filePath)) {
      continue;
    }

    merged.codocs.push({
      id: codoc.id,
      filePath: codoc.filePath,
      content: serializeCodocFromParsed(codoc),
      updatedAt: new Date(0).toISOString()
    });
  }

  return merged;
}

function serializeCodocFromParsed(codoc: ParsedCodoc): string {
  return stringifyYaml(codoc, {
    lineWidth: 0
  });
}

async function readDatabase(root: string): Promise<StoredCodocDatabase | null> {
  const storePath = resolveStorePath(root);

  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as StoredCodocDatabase;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.codocs)) {
      throw new Error(`Unsupported codoc store format at "${storePath}".`);
    }

    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
}

async function writeDatabase(root: string, database: StoredCodocDatabase): Promise<void> {
  const storePath = resolveStorePath(root);
  await mkdir(join(root, ".cobook"), { recursive: true });
  await writeFile(storePath, JSON.stringify(database, null, 2) + "\n", "utf8");
}

function resolveStorePath(root: string): string {
  return join(root, ".cobook", "codoc-store.json");
}

function emptyDatabase(): StoredCodocDatabase {
  return {
    version: STORE_VERSION,
    codocs: []
  };
}

function parseDatabaseRecords(records: StoredCodocRecord[]): Map<string, ParsedCodoc> {
  const codocs = new Map<string, ParsedCodoc>();

  for (const record of records) {
    const parsed = parseCodocText(record.filePath, record.content);
    if (codocs.has(parsed.id)) {
      throw new Error(`Duplicate codoc id "${parsed.id}" found in embedded storage.`);
    }

    codocs.set(parsed.id, parsed);
  }

  return codocs;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
