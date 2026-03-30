import { readFile } from "node:fs/promises";
import { parseJsonl } from "../../parsers/jsonl.js";
import { parseJson } from "../../parsers/json.js";

export interface LocalFileOptions {
  path: string;
  parser?: "jsonl" | "json" | "text";
}

const parsers: Record<string, (text: string) => unknown> = {
  jsonl: parseJsonl,
  json: parseJson,
  text: (t) => t,
};

/**
 * Read a local file and parse its contents.
 * Parser is selected by the `parser` option, defaulting to extension-based detection.
 */
export async function loadLocalFile(options: LocalFileOptions): Promise<unknown> {
  const { path: filePath, parser } = options;
  const text = await readFile(filePath, "utf-8");

  const parserName = parser ?? inferParser(filePath);
  const parseFn = parsers[parserName];
  if (!parseFn) {
    throw new Error(`Unknown parser: "${parserName}"`);
  }

  return parseFn(text);
}

function inferParser(filePath: string): string {
  if (filePath.endsWith(".jsonl")) return "jsonl";
  if (filePath.endsWith(".json")) return "json";
  return "text";
}
