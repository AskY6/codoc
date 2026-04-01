import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SourceError } from "./types.js";

export interface StaticSource {
  type: "static";
  value: unknown;
}

export interface FileSource {
  type: "file";
  path: string;
}

export type Source = StaticSource | FileSource;

/**
 * Execute a data source and return its resolved value.
 *
 * @param source  The source descriptor
 * @param workspaceRoot  Absolute path to the workspace root (used to resolve relative file paths)
 */
export async function executeSource(
  source: Source,
  workspaceRoot: string,
): Promise<unknown> {
  switch (source.type) {
    case "static":
      return source.value;

    case "file": {
      const abs = resolve(workspaceRoot, source.path);
      let raw: string;
      try {
        raw = await readFile(abs, "utf-8");
      } catch (err) {
        throw new SourceError(
          `Failed to read source file: ${abs}`,
          source.path,
        );
      }
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  }
}
