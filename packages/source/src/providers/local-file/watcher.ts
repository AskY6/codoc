import { watch, type FSWatcher } from "node:fs";

export interface LocalFileWatcher {
  close(): void;
}

/**
 * Watch a local file for content changes.
 * Calls `onChange` when the file is modified.
 * Debounces rapid changes (e.g. append-heavy files like JSONL).
 */
export function createLocalFileWatcher(
  filePath: string,
  onChange: () => void,
  debounceMs = 300,
): LocalFileWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher;

  try {
    watcher = watch(filePath, (eventType) => {
      if (eventType === "change") {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, debounceMs);
      }
    });
  } catch (err) {
    throw new Error(`Failed to watch file: ${filePath} — ${err}`);
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
