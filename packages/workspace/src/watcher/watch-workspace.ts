import { readdir } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { CobookConfig } from "../config/types.js";

import type { WorkspaceChangeEvent, WorkspaceWatcher } from "./types.js";

const POLL_INTERVAL_MS = 500;
const IGNORED_DIRS = new Set([".git", "dist", "node_modules"]);

export async function watchWorkspace(
  root: string,
  _config: CobookConfig,
  onEvent: (event: WorkspaceChangeEvent) => void | Promise<void>,
  onError?: (error: Error) => void | Promise<void>
): Promise<WorkspaceWatcher> {
  let closed = false;
  let scanning = false;
  let snapshot = await captureWorkspaceSnapshot(root);

  const timer = setInterval(() => {
    if (closed || scanning) {
      return;
    }

    scanning = true;
    void poll()
      .catch(async (error) => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(timer);
        await onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        scanning = false;
      });
  }, POLL_INTERVAL_MS);

  return {
    close() {
      closed = true;
      clearInterval(timer);
    }
  };

  async function poll(): Promise<void> {
    const nextSnapshot = await captureWorkspaceSnapshot(root);
    const knownPaths = new Set<string>([...snapshot.keys(), ...nextSnapshot.keys()]);

    for (const path of [...knownPaths].sort((left, right) => left.localeCompare(right))) {
      const previous = snapshot.get(path);
      const current = nextSnapshot.get(path);

      if (previous === undefined && current !== undefined) {
        await onEvent({
          kind: "created",
          path
        });
        continue;
      }

      if (previous !== undefined && current === undefined) {
        await onEvent({
          kind: "deleted",
          path
        });
        continue;
      }

      if (previous !== undefined && current !== undefined && previous !== current) {
        await onEvent({
          kind: "updated",
          path
        });
      }
    }

    snapshot = nextSnapshot;
  }
}

async function captureWorkspaceSnapshot(root: string): Promise<Map<string, number>> {
  const paths = await collectTrackedPaths(root);
  const snapshot = new Map<string, number>();

  for (const relativePath of paths) {
    const absolutePath = join(root, relativePath);

    try {
      const stats = await stat(absolutePath);
      snapshot.set(relativePath, stats.mtimeMs);
    } catch {
      continue;
    }
  }

  return snapshot;
}

async function collectTrackedPaths(root: string): Promise<string[]> {
  const paths = new Set<string>(["cobook.yaml"]);

  await walk(root);

  return [...paths].sort((left, right) => left.localeCompare(right));

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, {
      withFileTypes: true
    });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        await walk(join(currentDir, entry.name));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".codoc")) {
        paths.add(relative(root, join(currentDir, entry.name)).replace(/\\/g, "/"));
      }
    }
  }
}
