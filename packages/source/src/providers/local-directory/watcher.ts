import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";

export interface DirectoryChangeEvent {
  kind: "added" | "removed";
  name: string;
}

export interface LocalDirectoryWatcher {
  close(): void;
}

/**
 * Watch a directory for file additions and removals.
 * Compares snapshots on each fs event to determine what changed.
 */
export function createLocalDirectoryWatcher(
  dirPath: string,
  onChange: (events: DirectoryChangeEvent[]) => void,
  options?: { extension?: string; debounceMs?: number },
): LocalDirectoryWatcher {
  const { extension, debounceMs = 500 } = options ?? {};
  let knownFiles = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher;

  // Initial snapshot
  readdir(dirPath)
    .then((names) => {
      const filtered = extension
        ? names.filter((n) => n.endsWith(extension))
        : names;
      knownFiles = new Set(filtered);
    })
    .catch(() => {
      // directory may not exist yet
    });

  const check = async () => {
    try {
      const names = await readdir(dirPath);
      const current = new Set(
        extension ? names.filter((n) => n.endsWith(extension)) : names,
      );

      const events: DirectoryChangeEvent[] = [];

      for (const name of current) {
        if (!knownFiles.has(name)) {
          events.push({ kind: "added", name });
        }
      }
      for (const name of knownFiles) {
        if (!current.has(name)) {
          events.push({ kind: "removed", name });
        }
      }

      knownFiles = current;

      if (events.length > 0) {
        onChange(events);
      }
    } catch {
      // directory might have been deleted
    }
  };

  try {
    watcher = watch(dirPath, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, debounceMs);
    });
  } catch (err) {
    throw new Error(`Failed to watch directory: ${dirPath} — ${err}`);
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
