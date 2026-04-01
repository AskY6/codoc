import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { CobookConfig } from "../config/types.js";

const BUILTIN_IGNORED_DIRS = new Set([".git", "node_modules"]);

export async function scanCodocFiles(root: string, config: CobookConfig): Promise<string[]> {
  const files: string[] = [];
  const ignoredDirs = new Set<string>([
    ...BUILTIN_IGNORED_DIRS,
    ...extractExcludedRoots(config.exclude)
  ]);

  await walk(root);

  return files.sort();

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(root, fullPath);

      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) {
          continue;
        }

        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && relativePath.endsWith(".codoc")) {
        files.push(relativePath);
      }
    }
  }
}

function extractExcludedRoots(exclude: string[] | undefined): string[] {
  if (!exclude) {
    return ["dist"];
  }

  const roots = new Set<string>(["dist"]);

  for (const pattern of exclude) {
    const [first] = pattern.split("/");
    if (first) {
      roots.add(first);
    }
  }

  return Array.from(roots);
}
