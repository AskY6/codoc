// source-state — persistent runtime state for $source fields with interval.
//
// Stores lastFetchedAt timestamps and cached resolved values in a JSON file
// at <sourceDir>/.source-state.json. Keyed by NodeId (codocPath#data.fieldName).
//
// Loss of this file is non-fatal: all periodic sources re-fetch immediately
// on next startup.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeId } from "@cobook/core";

export interface SourceStateEntry {
  lastFetchedAt: string;
  cachedValue?: unknown;
}

export type SourceStateMap = Readonly<Record<string, SourceStateEntry>>;

const STATE_FILENAME = ".source-state.json";

export function stateFilePath(sourceDir: string): string {
  return join(sourceDir, STATE_FILENAME);
}

export async function readSourceState(sourceDir: string): Promise<SourceStateMap> {
  try {
    const raw = await readFile(stateFilePath(sourceDir), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SourceStateMap;
    }
  } catch {
    // File missing or corrupt — start fresh.
  }
  return {};
}

export async function writeSourceState(
  sourceDir: string,
  state: SourceStateMap,
): Promise<void> {
  await writeFile(stateFilePath(sourceDir), JSON.stringify(state, null, 2), "utf-8");
}

export function withEntry(
  state: SourceStateMap,
  nodeId: NodeId,
  entry: SourceStateEntry,
): SourceStateMap {
  return { ...state, [nodeId]: entry };
}
