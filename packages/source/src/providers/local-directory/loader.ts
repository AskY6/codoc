import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface LocalDirectoryOptions {
  path: string;
  /** Glob-like extension filter, e.g. ".jsonl" */
  extension?: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Scan a local directory and return file entries.
 * Optionally filter by extension.
 */
export async function loadLocalDirectory(
  options: LocalDirectoryOptions,
): Promise<DirectoryEntry[]> {
  const { path: dirPath, extension } = options;
  const names = await readdir(dirPath);

  const filtered = extension
    ? names.filter((n) => n.endsWith(extension))
    : names;

  const entries: DirectoryEntry[] = [];
  for (const name of filtered) {
    const fullPath = join(dirPath, name);
    const s = await stat(fullPath);
    if (s.isFile()) {
      entries.push({
        name,
        path: fullPath,
        size: s.size,
        mtimeMs: s.mtimeMs,
      });
    }
  }

  return entries;
}
