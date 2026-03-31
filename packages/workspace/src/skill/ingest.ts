import { join } from "node:path";
import { DataTree } from "@codoc/core";
import {
  loadLocalDirectory,
  createLocalFileWatcher,
  createLocalDirectoryWatcher,
  type LocalFileWatcher,
  type LocalDirectoryWatcher,
} from "@codoc/source";
import { buildDAGFromTree } from "../wiring/bootstrap.js";
import { DocRegistry } from "../lifecycle/instance-store.js";
import { WatchOrchestrator } from "../watch/orchestrator.js";
import type { Skill } from "./types.js";

export interface IngestResult {
  /** All docIds created during ingestion */
  docIds: string[];
  /** Dispose all watchers and cleanup */
  dispose: () => void;
}

/**
 * Ingest a directory using a skill.
 *
 * This implements CLAUDE_CODE_LOG_VIEWER Phase 1:
 * 1. Scan directory for matching files
 * 2. For each file, create a codoc instance via skill.mapToCodoc
 * 3. Build DAG and register in the DocRegistry
 * 4. Start watchers for live updates (file changes + new files)
 */
export async function ingestDirectory(
  dirPath: string,
  skill: Skill,
  registry: DocRegistry,
  orchestrator: WatchOrchestrator,
): Promise<IngestResult> {
  // Step 2: Directory scan
  const entries = await loadLocalDirectory({
    path: dirPath,
    extension: skill.extension,
  });

  const docIds: string[] = [];
  const fileWatchers: LocalFileWatcher[] = [];

  // Step 3: Batch create codocs
  for (const entry of entries) {
    const docId = toDocId(entry.name);
    const codoc = skill.mapToCodoc(entry.path, entry.name);

    const tree = new DataTree({ schema: codoc.meta.data, data: codoc.data });
    const dag = buildDAGFromTree(tree);
    registry.register(docId, tree, dag);
    docIds.push(docId);

    // Step 5 (per-file): Watch each file for content changes
    const watcher = createLocalFileWatcher(entry.path, () => {
      // Route to orchestrator as source_changed
      orchestrator.handleSourceChanged(docId, "/messages");
    });
    fileWatchers.push(watcher);
  }

  // Step 5 (directory-level): Watch for new files
  const dirWatcher = createLocalDirectoryWatcher(
    dirPath,
    (events) => {
      for (const event of events) {
        if (event.kind === "added" && event.name.endsWith(skill.extension)) {
          const filePath = join(dirPath, event.name);
          const docId = toDocId(event.name);

          // Step 15: Create new codoc for the added file
          if (registry.has(docId)) continue;

          const codoc = skill.mapToCodoc(filePath, event.name);
          const tree = new DataTree({ schema: codoc.meta.data, data: codoc.data });
          const dag = buildDAGFromTree(tree);
          registry.register(docId, tree, dag);
          docIds.push(docId);

          // Watch the new file
          const watcher = createLocalFileWatcher(filePath, () => {
            orchestrator.handleSourceChanged(docId, "/messages");
          });
          fileWatchers.push(watcher);
        }
      }
    },
    { extension: skill.extension },
  );

  return {
    docIds,
    dispose() {
      for (const w of fileWatchers) w.close();
      dirWatcher.close();
    },
  };
}

function toDocId(fileName: string): string {
  // e.g. "aaa.jsonl" → "session-aaa.codoc"
  const base = fileName.replace(/\.[^.]+$/, "");
  return `session-${base}.codoc`;
}
